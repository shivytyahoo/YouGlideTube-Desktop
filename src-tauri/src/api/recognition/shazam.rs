//! Shazam discovery client.
//!
//! A faithful port of Android's `ShazamClient` (itself ported from
//! Metrolist's :shazamkit, GPL-3.0): posts a DejaVu signature to the public
//! Android discovery endpoint and maps the match to a [`RecognitionResult`].
//! The endpoint needs no API key — Android calls it directly from the app.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rand::RngExt;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::errors::AppError;

/// An identified song, decoupled from the Shazam JSON shape — the same
/// fields Android's `RecognitionResult` carries.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecognitionResult {
    pub track_id: String,
    pub title: String,
    pub artist: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover_art_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover_art_hq_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub genre: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lyrics: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shazam_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub apple_music_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spotify_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub isrc: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub youtube_video_id: Option<String>,
}

const MAX_RETRIES: usize = 3;
const INITIAL_RETRY_DELAY_MS: u64 = 2000;

const USER_AGENTS: &[&str] = &[
    "Dalvik/2.1.0 (Linux; U; Android 5.0.2; VS980 4G Build/LRX22G)",
    "Dalvik/1.6.0 (Linux; U; Android 4.4.2; SM-T210 Build/KOT49H)",
    "Dalvik/2.1.0 (Linux; U; Android 5.1.1; SM-P905V Build/LMY47X)",
    "Dalvik/2.1.0 (Linux; U; Android 6.0.1; SM-G920F Build/MMB29K)",
    "Dalvik/2.1.0 (Linux; U; Android 5.0; SM-G900F Build/LRX21T)",
];
const TIMEZONES: &[&str] = &[
    "Europe/Paris",
    "Europe/London",
    "America/New_York",
    "America/Los_Angeles",
    "Asia/Tokyo",
    "Asia/Dubai",
];

#[derive(Debug, Serialize)]
struct ShazamRequestJson {
    geolocation: Geolocation,
    signature: Signature,
    timestamp: u64,
    timezone: String,
}

#[derive(Debug, Serialize)]
struct Geolocation {
    altitude: f64,
    latitude: f64,
    longitude: f64,
}

#[derive(Debug, Serialize)]
struct Signature {
    samplems: u64,
    timestamp: u64,
    uri: String,
}

#[derive(Debug, Deserialize)]
struct ShazamResponseJson {
    track: Option<Track>,
    #[serde(default)]
    tagid: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Track {
    #[serde(default)]
    key: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    subtitle: Option<String>,
    #[serde(default)]
    images: Option<Images>,
    #[serde(default)]
    hub: Option<Hub>,
    #[serde(default)]
    sections: Option<Vec<Option<Section>>>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    isrc: Option<String>,
    #[serde(default)]
    genres: Option<Genres>,
}

#[derive(Debug, Deserialize)]
struct Images {
    #[serde(default)]
    coverart: Option<String>,
    #[serde(default)]
    coverarthq: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Hub {
    #[serde(default)]
    options: Option<Vec<Option<HubOption>>>,
    #[serde(default)]
    providers: Option<Vec<Option<Provider>>>,
}

#[derive(Debug, Deserialize)]
struct HubOption {
    #[serde(default)]
    actions: Option<Vec<Option<HubAction>>>,
    #[serde(default)]
    #[serde(rename = "type")]
    option_type: Option<String>,
    #[serde(default)]
    providername: Option<String>,
}

#[derive(Debug, Deserialize)]
struct HubAction {
    #[serde(default)]
    uri: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Provider {
    #[serde(default)]
    caption: Option<String>,
    #[serde(default)]
    actions: Option<Vec<Option<HubAction>>>,
}

#[derive(Debug, Deserialize)]
struct Section {
    #[serde(default)]
    #[serde(rename = "type")]
    section_type: Option<String>,
    #[serde(default)]
    metadata: Option<Vec<Option<Metadata>>>,
    #[serde(default)]
    text: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct Metadata {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Genres {
    #[serde(default)]
    primary: Option<String>,
}

/// Posts `signature` to the Shazam discovery endpoint and returns the match.
/// Retries a 429 up to three times with exponential backoff, as Android does.
pub async fn recognize(
    client: &reqwest::Client,
    signature: &str,
    sample_duration_ms: u64,
) -> Result<RecognitionResult, AppError> {
    let mut last_error: Option<AppError> = None;
    for attempt in 0..MAX_RETRIES {
        match perform_recognition(client, signature, sample_duration_ms).await {
            Ok(result) => return Ok(result),
            Err(error) => {
                let rate_limited = matches!(error, AppError::RateLimited(_));
                if rate_limited && attempt + 1 < MAX_RETRIES {
                    tokio::time::sleep(Duration::from_millis(
                        INITIAL_RETRY_DELAY_MS * (1 << attempt),
                    ))
                    .await;
                    last_error = Some(error);
                } else {
                    return Err(error);
                }
            }
        }
    }
    Err(last_error.unwrap_or_else(|| AppError::Network("Recognition failed".to_string())))
}

async fn perform_recognition(
    client: &reqwest::Client,
    signature: &str,
    sample_duration_ms: u64,
) -> Result<RecognitionResult, AppError> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // All randomness is drawn up front: `ThreadRng` is not `Send`, so it
    // must not be alive across the `.await` below.
    let (uuid1, uuid2, geolocation, timezone, user_agent) = {
        let mut rng = rand::rng();
        (
            Uuid::new_v4().to_string().to_uppercase(),
            Uuid::new_v4().to_string(),
            Geolocation {
                altitude: rng.random_range(100.0..500.0),
                latitude: rng.random_range(-90.0..90.0),
                longitude: rng.random_range(-180.0..180.0),
            },
            TIMEZONES[rng.random_range(0..TIMEZONES.len())].to_string(),
            USER_AGENTS[rng.random_range(0..USER_AGENTS.len())].to_string(),
        )
    };

    let request = ShazamRequestJson {
        // The endpoint expects a location; Android sends random noise
        // values rather than the user's real position.
        geolocation,
        signature: Signature {
            samplems: sample_duration_ms,
            timestamp,
            uri: signature.to_string(),
        },
        timestamp,
        timezone,
    };

    // The query string is static ASCII, so it is baked into the URL instead
    // of reqwest's `.query()` (the crate is built without that feature).
    let url = format!(
        "https://amp.shazam.com/discovery/v5/en/US/android/-/tag/{uuid1}/{uuid2}?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&video=v3"
    );
    let response = client
        .post(url)
        .header(reqwest::header::USER_AGENT, user_agent)
        .header("Content-Language", "en_US")
        .json(&request)
        .send()
        .await
        .map_err(|error| AppError::Network(map_transport_error(&error)))?;

    let status = response.status();
    if !status.is_success() {
        return Err(error_for_status(status.as_u16()));
    }

    let body: ShazamResponseJson = response
        .json()
        .await
        .map_err(|error| AppError::Network(format!("Recognition failed: {error}")))?;
    body.to_recognition_result()
        .ok_or_else(|| AppError::RecognitionNoMatch("Shazam returned no track".to_string()))
}

/// Maps an HTTP status to the recognition failure Android reports for it.
fn error_for_status(status: u16) -> AppError {
    match status {
        429 => AppError::RateLimited("Too many requests".to_string()),
        404 => AppError::RecognitionNoMatch("No match found".to_string()),
        500..=599 => AppError::Network("Shazam service temporarily unavailable".to_string()),
        _ => AppError::Network(format!("Recognition failed (error {status})")),
    }
}

fn map_transport_error(error: &reqwest::Error) -> String {
    if error.is_timeout() || error.is_connect() {
        "Recognition needs an internet connection.".to_string()
    } else {
        format!("Recognition failed: {error}")
    }
}

impl ShazamResponseJson {
    fn to_recognition_result(&self) -> Option<RecognitionResult> {
        let track = self.track.as_ref()?;

        // A track without SONG sections still maps — only the album/label
        // fields stay empty, as Android's `?.` chains do.
        let song_metadata = track.sections.as_ref().and_then(|sections| {
            sections
                .iter()
                .flatten()
                .find(|section| section.section_type.as_deref() == Some("SONG"))
                .and_then(|section| section.metadata.as_ref())
        });
        let find_meta = |title: &str| {
            song_metadata.and_then(|metadata| {
                metadata
                    .iter()
                    .flatten()
                    .find(|item| item.title.as_deref() == Some(title))
                    .and_then(|item| item.text.clone())
            })
        };
        let lyrics = track.sections.as_ref().and_then(|sections| {
            sections
                .iter()
                .flatten()
                .find(|section| section.section_type.as_deref() == Some("LYRICS"))
                .and_then(|section| section.text.clone())
        });

        let hub_options = track.hub.as_ref().and_then(|hub| hub.options.as_ref());
        let apple_music_url = hub_options.and_then(|options| {
            options
                .iter()
                .flatten()
                .filter(|option| {
                    option
                        .providername
                        .as_deref()
                        .is_some_and(|name| name.to_lowercase().contains("apple"))
                })
                .filter_map(|option| option.actions.as_ref()?.iter().flatten().next())
                .filter_map(|action| action.uri.clone())
                .next()
        });
        let spotify_url = track
            .hub
            .as_ref()
            .and_then(|hub| hub.providers.as_ref())
            .and_then(|providers| {
                providers
                    .iter()
                    .flatten()
                    .find(|provider| {
                        provider
                            .caption
                            .as_deref()
                            .is_some_and(|caption| caption.to_lowercase().contains("spotify"))
                    })
                    .and_then(|provider| provider.actions.as_ref()?.iter().flatten().next())
                    .and_then(|action| action.uri.clone())
            });
        let youtube_uri = hub_options.and_then(|options| {
            options
                .iter()
                .flatten()
                .filter(|option| {
                    option
                        .option_type
                        .as_deref()
                        .is_some_and(|kind| kind.to_lowercase().contains("video"))
                })
                .filter_map(|option| option.actions.as_ref()?.iter().flatten().next())
                .filter_map(|action| action.uri.clone())
                .next()
        });
        let youtube_video_id = youtube_uri.as_deref().and_then(youtube_video_id_from_uri);

        Some(RecognitionResult {
            track_id: track
                .key
                .clone()
                .or_else(|| self.tagid.clone())
                .unwrap_or_default(),
            title: track.title.clone().unwrap_or_default(),
            artist: track.subtitle.clone().unwrap_or_default(),
            album: find_meta("Album"),
            cover_art_url: track
                .images
                .as_ref()
                .and_then(|images| images.coverart.clone()),
            cover_art_hq_url: track
                .images
                .as_ref()
                .and_then(|images| images.coverarthq.clone()),
            genre: track
                .genres
                .as_ref()
                .and_then(|genres| genres.primary.clone()),
            release_date: find_meta("Released"),
            label: find_meta("Label"),
            lyrics,
            shazam_url: track.url.clone(),
            apple_music_url,
            spotify_url,
            isrc: track.isrc.clone(),
            youtube_video_id,
        })
    }
}

/// Extracts the YouTube video id from a hub action URI, as Android does:
/// the part after the last `v=`, else the last path segment when it is
/// exactly 11 characters.
fn youtube_video_id_from_uri(uri: &str) -> Option<String> {
    let after_v = uri.rsplit_once("v=").map(|(_, after)| after).unwrap_or("");
    if !after_v.is_empty() {
        return Some(after_v.to_string());
    }
    let after_slash = uri.rsplit_once('/').map(|(_, after)| after).unwrap_or("");
    if !after_slash.is_empty() && after_slash.len() == 11 {
        return Some(after_slash.to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn response_json() -> serde_json::Value {
        serde_json::json!({
            "tagid": "tag-1",
            "track": {
                "key": "12345",
                "title": "Test Song",
                "subtitle": "Test Artist",
                "images": {
                    "coverart": "https://example.test/cover.jpg",
                    "coverarthq": "https://example.test/cover-hq.jpg"
                },
                "hub": {
                    "options": [
                        {
                            "providername": "Apple Music",
                            "actions": [{ "type": "uri", "uri": "https://music.apple.com/x" }]
                        },
                        {
                            "type": "VIDEO",
                            "actions": [{ "type": "uri", "uri": "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }]
                        }
                    ],
                    "providers": [
                        {
                            "caption": "Open in Spotify",
                            "actions": [{ "type": "uri", "uri": "https://open.spotify.com/track/abc" }]
                        }
                    ]
                },
                "sections": [
                    {
                        "type": "SONG",
                        "metadata": [
                            { "title": "Album", "text": "Test Album" },
                            { "title": "Label", "text": "Test Label" },
                            { "title": "Released", "text": "2020" }
                        ]
                    },
                    { "type": "LYRICS", "text": ["la", "la"] }
                ],
                "url": "https://www.shazam.com/track/12345",
                "isrc": "USXX12000001",
                "genres": { "primary": "Pop" }
            }
        })
    }

    #[test]
    fn parses_a_full_shazam_response() {
        let body: ShazamResponseJson =
            serde_json::from_value(response_json()).expect("fixture must parse");
        let result = body.to_recognition_result().expect("fixture must map");
        assert_eq!(result.track_id, "12345");
        assert_eq!(result.title, "Test Song");
        assert_eq!(result.artist, "Test Artist");
        assert_eq!(result.album.as_deref(), Some("Test Album"));
        assert_eq!(
            result.cover_art_url.as_deref(),
            Some("https://example.test/cover.jpg")
        );
        assert_eq!(
            result.cover_art_hq_url.as_deref(),
            Some("https://example.test/cover-hq.jpg")
        );
        assert_eq!(result.genre.as_deref(), Some("Pop"));
        assert_eq!(result.release_date.as_deref(), Some("2020"));
        assert_eq!(result.label.as_deref(), Some("Test Label"));
        assert_eq!(
            result.lyrics.as_deref(),
            Some(&["la".to_string(), "la".to_string()][..])
        );
        assert_eq!(
            result.shazam_url.as_deref(),
            Some("https://www.shazam.com/track/12345")
        );
        assert_eq!(
            result.apple_music_url.as_deref(),
            Some("https://music.apple.com/x")
        );
        assert_eq!(
            result.spotify_url.as_deref(),
            Some("https://open.spotify.com/track/abc")
        );
        assert_eq!(result.isrc.as_deref(), Some("USXX12000001"));
        assert_eq!(result.youtube_video_id.as_deref(), Some("dQw4w9WgXcQ"));
    }

    #[test]
    fn missing_track_is_no_result() {
        let body: ShazamResponseJson =
            serde_json::from_value(serde_json::json!({ "tagid": "tag-1" }))
                .expect("fixture must parse");
        assert!(body.to_recognition_result().is_none());
    }

    #[test]
    fn bare_track_still_maps_without_sections_or_hub() {
        let body: ShazamResponseJson = serde_json::from_value(serde_json::json!({
            "track": { "title": "Bare", "subtitle": "Artist" }
        }))
        .expect("fixture must parse");
        let result = body.to_recognition_result().expect("bare track must map");
        assert_eq!(result.title, "Bare");
        assert_eq!(result.artist, "Artist");
        assert_eq!(result.album, None);
        assert_eq!(result.youtube_video_id, None);
    }

    #[test]
    fn track_id_falls_back_to_tagid() {
        let mut json = response_json();
        json["track"].as_object_mut().unwrap().remove("key");
        let body: ShazamResponseJson = serde_json::from_value(json).unwrap();
        assert_eq!(body.to_recognition_result().unwrap().track_id, "tag-1");
    }

    #[test]
    fn youtube_id_from_short_path() {
        assert_eq!(
            youtube_video_id_from_uri("https://youtu.be/dQw4w9WgXcQ"),
            Some("dQw4w9WgXcQ".to_string())
        );
        assert_eq!(youtube_video_id_from_uri("https://example.test/x"), None);
        assert_eq!(youtube_video_id_from_uri(""), None);
    }

    #[test]
    fn status_errors_map_like_android() {
        assert!(matches!(error_for_status(429), AppError::RateLimited(_)));
        assert!(matches!(
            error_for_status(404),
            AppError::RecognitionNoMatch(_)
        ));
        assert!(matches!(error_for_status(503), AppError::Network(_)));
        assert!(matches!(error_for_status(400), AppError::Network(_)));
    }
}
