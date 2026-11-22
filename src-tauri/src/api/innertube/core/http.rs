use crate::api::innertube::InnertubeClient;
use crate::api::innertube::core::clients::YouTubeClient;
use crate::api::innertube::transport::error::{TransportError, to_app_error};
use crate::api::innertube::transport::request::{
    Host, RequestSpec, body_visitor, ensure_context, strip_visitor,
};
use crate::api::innertube::transport::send::send;
use crate::errors::AppResult;
use serde_json::Value;

/// Percent-encode for InnerTube query strings, which want `+` for spaces rather
/// than the `%20` a general-purpose encoder emits.
pub fn custom_url_encode(s: &str) -> String {
    let mut encoded = String::new();
    for b in s.as_bytes() {
        match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(*b as char);
            }
            b' ' => encoded.push('+'),
            _ => encoded.push_str(&format!("%{:02X}", b)),
        }
    }
    encoded
}

impl InnertubeClient {
    /// POST to the main-site InnerTube API as `client`.
    ///
    /// The client's User-Agent, numeric id and version all come from the one
    /// registry entry, so a request can never claim to be one build in its
    /// context and another in its headers.
    pub async fn post_innertube(
        &self,
        endpoint: &str,
        client: &YouTubeClient,
        payload: &mut Value,
    ) -> AppResult<Value> {
        self.post_via(
            &self.client,
            Host::Www,
            endpoint,
            client,
            payload,
            None,
            None,
        )
        .await
    }

    /// [`Self::post_innertube`] on the dedicated playback connection pool, for
    /// the requests first frame waits on.
    pub async fn post_innertube_for_playback(
        &self,
        endpoint: &str,
        client: &YouTubeClient,
        payload: &mut Value,
    ) -> AppResult<Value> {
        self.post_via(
            &self.playback_client,
            Host::Www,
            endpoint,
            client,
            payload,
            None,
            None,
        )
        .await
    }

    /// A `player` request on the playback pool, with an optional referer.
    pub async fn post_player(
        &self,
        client: &YouTubeClient,
        payload: &mut Value,
        referer: Option<&str>,
    ) -> AppResult<Value> {
        self.post_via(
            &self.playback_client,
            Host::Www,
            "player",
            client,
            payload,
            referer,
            None,
        )
        .await
    }

    /// [`Self::post_player`], but the transport error comes back unconverted, so
    /// the caller can tell a refusal (a 4xx — retrying the same request cannot
    /// fix it) from a timeout or transport failure (worth one more try).
    pub(crate) async fn post_player_raw(
        &self,
        client: &YouTubeClient,
        payload: &mut Value,
        referer: Option<&str>,
    ) -> Result<Value, TransportError> {
        self.post_via_raw(
            &self.playback_client,
            Host::Www,
            "player",
            client,
            payload,
            referer,
            None,
            &[],
        )
        .await
    }

    /// The signed-in headers for a request as `client`: `None` when signed out,
    /// and `None` for a client that never logs in. Android's `VISIONOS` and
    /// `IOS` carry `loginSupported = false`, and a valid session sent on them
    /// is a deterministic HTTP 400 while the same request anonymous answers
    /// fine — so the gate lives here, where every InnerTube call passes, not
    /// at each call site.
    #[must_use]
    pub(crate) fn auth_headers_for(
        &self,
        client: &YouTubeClient,
    ) -> Option<crate::auth::sapisid::AuthHeaders> {
        if !client.login_supported {
            return None;
        }
        self.auth.as_ref().and_then(|session| session.auth_headers())
    }

    /// Send one request through the shared transport.
    ///
    /// A body without a context gets this client's, carrying the visitor
    /// identity; a body with one is sent as the caller built it. When the server
    /// answers 400 to an identity added here, the request is repeated once
    /// without it and that identity is dropped, as the Android app does.
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn post_via(
        &self,
        http: &reqwest::Client,
        host: Host,
        endpoint: &str,
        client: &YouTubeClient,
        payload: &mut Value,
        referer: Option<&str>,
        extra_query: Option<&str>,
    ) -> AppResult<Value> {
        self.post_via_raw(http, host, endpoint, client, payload, referer, extra_query, &[])
            .await
            .map_err(|error| to_app_error(endpoint, &error))
    }

    /// [`Self::post_innertube`] carrying extra headers for this one call
    /// (the comment create's `X-Goog-AuthUser` retry). The transport error
    /// comes back unconverted, so the caller can tell a 404 from any other
    /// refusal.
    pub(crate) async fn post_innertube_extra(
        &self,
        endpoint: &str,
        client: &YouTubeClient,
        payload: &mut Value,
        extra_headers: &[(&'static str, &'static str)],
    ) -> Result<Value, TransportError> {
        self.post_via_raw(
            &self.client,
            Host::Www,
            endpoint,
            client,
            payload,
            None,
            None,
            extra_headers,
        )
        .await
    }

    /// [`Self::post_via`], but the transport error comes back unconverted, so
    /// a caller can tell a 4xx (safe to retry elsewhere) from a 5xx or a
    /// transport failure (the request may have applied).
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn post_via_raw(
        &self,
        http: &reqwest::Client,
        host: Host,
        endpoint: &str,
        client: &YouTubeClient,
        payload: &mut Value,
        referer: Option<&str>,
        extra_query: Option<&str>,
        extra_headers: &[(&'static str, &'static str)],
    ) -> Result<Value, TransportError> {
        let spec = RequestSpec {
            host,
            endpoint,
            client,
            referer,
            extra_query,
            extra_headers,
        };
        let added = if payload.get("context").is_some() {
            false
        } else {
            let visitor = self.fetch_visitor_data().await;
            let (language, country) = if endpoint == "player" {
                ("en".to_string(), "US".to_string())
            } else if host == Host::Music {
                // Music browse/search follow the music language and country
                // when set, else the content language and country.
                (
                    super::locale::music_content_language(),
                    super::locale::music_content_country(),
                )
            } else {
                (
                    super::locale::content_language(),
                    super::locale::content_country(),
                )
            };
            ensure_context(payload, client, visitor.as_deref(), &language, &country)
        };
        let visitor = body_visitor(payload).map(ToOwned::to_owned);
        // The signed-in headers are computed fresh per call, so sign-in and
        // sign-out take effect on the very next request; `None` keeps the
        // call anonymous — including for clients that never log in.
        let auth = self.auth_headers_for(client);
        match send(http, &spec, payload, visitor.as_deref(), auth.as_ref()).await {
            Err(TransportError::Status { code: 400, .. }) if added && visitor.is_some() => {
                strip_visitor(payload);
                let retried = send(http, &spec, payload, None, auth.as_ref()).await;
                if retried.is_ok() {
                    if let Some(rejected) = visitor.as_deref() {
                        self.identity.forget_if(rejected);
                    }
                    tracing::warn!(
                        endpoint,
                        "visitor identity rejected; request succeeded without it"
                    );
                }
                retried
            }
            result => result,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::innertube::core::clients;
    use crate::auth::AuthSession;
    use std::sync::Arc;

    fn signed_in_client() -> (InnertubeClient, std::path::PathBuf) {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("youglide-http-test-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let session = AuthSession::new(&dir);
        session
            .sign_in("SAPISID=abc123; SID=def456; other=1")
            .unwrap();
        let client = InnertubeClient {
            auth: Some(Arc::new(session)),
            ..Default::default()
        };
        (client, dir)
    }

    #[test]
    fn signed_in_auth_is_withheld_from_clients_that_never_log_in() {
        let (client, dir) = signed_in_client();
        // The 400s in the user's log: a valid session on these clients is a
        // refusal, while the same request anonymous answers fine.
        assert!(client.auth_headers_for(&clients::VISIONOS).is_none());
        assert!(client.auth_headers_for(&clients::IOS).is_none());
        assert!(client.auth_headers_for(&clients::IPADOS).is_none());
        assert!(client.auth_headers_for(&clients::ANDROID_VR).is_none());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn signed_in_auth_still_flows_to_browse_and_player_clients() {
        let (client, dir) = signed_in_client();
        // Signed-in browse/search/feed/subscriptions go out as WEB/WEB_REMIX,
        // and the ladder's later clients keep their session too.
        for candidate in [
            &clients::WEB,
            &clients::MWEB,
            &clients::WEB_REMIX,
            &clients::ANDROID,
            &clients::TV_TIZEN,
        ] {
            let headers = client.auth_headers_for(candidate);
            assert!(headers.is_some(), "{} must carry auth", candidate.name);
            assert!(headers.unwrap().authorization.starts_with("SAPISIDHASH "));
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn signed_out_has_no_headers_for_any_client() {
        let client = InnertubeClient::default();
        assert!(client.auth_headers_for(&clients::WEB).is_none());
        assert!(client.auth_headers_for(&clients::VISIONOS).is_none());
    }
}
