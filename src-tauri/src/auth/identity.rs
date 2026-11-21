//! The signed-in Google account's display identity: name, email, channel
//! handle and photo, exactly as Android's `YouTube.accountInfo()` reads
//! them from InnerTube `account/account_menu`
//! (`actions[0].openPopupAction.popup.multiPageMenuRenderer.header.
//! activeAccountHeaderRenderer`).
//!
//! Pure data + parsing only — no network here. The fetch lives in
//! `crate::api::innertube::account`; the cache lives in `AuthSession`.
//! Nothing here is secret (a display name and a public photo URL), but
//! it is only ever stored next to the session, in the 0600
//! `google-account.json` file, and never logged.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The signed-in account, as the account menu reports it. Every field is
/// optional: the menu answers without an account when signed out, and
/// individual fields (email, handle, photo) are missing for some accounts.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    pub name: Option<String>,
    pub email: Option<String>,
    pub channel_handle: Option<String>,
    pub thumbnail_url: Option<String>,
}

impl AccountInfo {
    /// Android's `SavedAccount.displayName`: name, else channel handle,
    /// else email. The top bar shows the first letter of this.
    #[must_use]
    pub fn display_name(&self) -> Option<&str> {
        self.name
            .as_deref()
            .or(self.channel_handle.as_deref())
            .or(self.email.as_deref())
    }
}

/// Parse one `account_menu` response. `None` when the response carries no
/// signed-in account (anonymous visitor, or a shape change upstream).
#[must_use]
pub fn parse_account_info(value: &Value) -> Option<AccountInfo> {
    let header = value
        .get("actions")?
        .get(0)?
        .get("openPopupAction")?
        .get("popup")?
        .get("multiPageMenuRenderer")?
        .get("header")?
        .get("activeAccountHeaderRenderer")?;
    let name = text_field(header.get("accountName"));
    let email = text_field(header.get("accountEmail"));
    let channel_handle = text_field(header.get("channelHandle"));
    // The photo is optional: some accounts have no thumbnail, and the
    // name/handle/email above are what identify the account.
    let thumbnail_url = header
        .get("accountPhoto")
        .and_then(|photo| photo.get("thumbnails"))
        .and_then(Value::as_array)
        .and_then(|thumbs| thumbs.last())
        .and_then(|thumb| thumb.get("url"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    // A header with no name at all is not an account we can show.
    if name.is_none() && email.is_none() && channel_handle.is_none() {
        return None;
    }
    Some(AccountInfo {
        name,
        email,
        channel_handle,
        thumbnail_url,
    })
}

/// A renderer text field is either `{"simpleText": "..."}` or
/// `{"runs": [{"text": "..."}, ...]}`; Android reads the first run.
fn text_field(field: Option<&Value>) -> Option<String> {
    let field = field?;
    if let Some(text) = field.get("simpleText").and_then(Value::as_str) {
        return Some(text.to_owned());
    }
    field
        .get("runs")?
        .as_array()?
        .first()?
        .get("text")?
        .as_str()
        .map(ToOwned::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn header_response() -> Value {
        json!({
            "actions": [{
                "openPopupAction": {
                    "popup": {
                        "multiPageMenuRenderer": {
                            "header": {
                                "activeAccountHeaderRenderer": {
                                    "accountName": { "runs": [{ "text": "Shivam" }] },
                                    "accountEmail": { "simpleText": "shivam@example.com" },
                                    "channelHandle": { "runs": [{ "text": "@shivyt" }] },
                                    "accountPhoto": { "thumbnails": [
                                        { "url": "https://example.com/s32/photo.jpg", "width": 32, "height": 32 },
                                        { "url": "https://example.com/s88/photo.jpg", "width": 88, "height": 88 }
                                    ]}
                                }
                            }
                        }
                    }
                }
            }]
        })
    }

    #[test]
    fn parses_the_full_header() {
        let info = parse_account_info(&header_response()).unwrap();
        assert_eq!(info.name.as_deref(), Some("Shivam"));
        assert_eq!(info.email.as_deref(), Some("shivam@example.com"));
        assert_eq!(info.channel_handle.as_deref(), Some("@shivyt"));
        // The largest thumbnail, like Android's `SavedAccount.thumbnailUrl`.
        assert_eq!(
            info.thumbnail_url.as_deref(),
            Some("https://example.com/s88/photo.jpg")
        );
        assert_eq!(info.display_name(), Some("Shivam"));
    }

    #[test]
    fn display_name_falls_back_to_handle_then_email() {
        let mut info = AccountInfo::default();
        assert_eq!(info.display_name(), None);
        info.email = Some("a@example.com".to_string());
        assert_eq!(info.display_name(), Some("a@example.com"));
        info.channel_handle = Some("@handle".to_string());
        assert_eq!(info.display_name(), Some("@handle"));
        info.name = Some("Name".to_string());
        assert_eq!(info.display_name(), Some("Name"));
    }

    #[test]
    fn name_only_is_enough() {
        let mut response = header_response();
        let header = response["actions"][0]["openPopupAction"]["popup"]
            ["multiPageMenuRenderer"]["header"]["activeAccountHeaderRenderer"]
            .as_object_mut()
            .unwrap();
        header.remove("accountEmail");
        header.remove("channelHandle");
        header.remove("accountPhoto");
        let info = parse_account_info(&response).unwrap();
        assert_eq!(info.display_name(), Some("Shivam"));
        assert_eq!(info.thumbnail_url, None);
    }

    #[test]
    fn no_account_header_means_no_account() {
        assert_eq!(parse_account_info(&json!({})), None);
        assert_eq!(parse_account_info(&json!({ "actions": [] })), None);
        assert_eq!(
            parse_account_info(&json!({
                "actions": [{ "openPopupAction": { "popup": {
                    "multiPageMenuRenderer": { "header": {} }
                } } }]
            })),
            None
        );
    }
}
