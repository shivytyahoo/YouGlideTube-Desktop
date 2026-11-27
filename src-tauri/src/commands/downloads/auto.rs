//! Saving new uploads from chosen channels: the opt-in map, the per-pass
//! candidate check, and the rules that keep it to fresh, watchable videos.

use std::collections::{HashMap, HashSet};

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::State;

use crate::db::{download_jobs, downloads, settings};
use crate::errors::ErrorResponse;
use crate::models::video::VideoSummary;
use crate::services::subscription_feed::{self, ChannelUploads};
use crate::services::youtube_service::YoutubeService;

use super::StartDownloadRequest;

/// The settings key holding `{ channelId: opt-in epoch seconds }`.
pub const AUTO_DOWNLOAD_CHANNELS_KEY: &str = "auto_download_channels";
/// New uploads per channel in one pass: the queue stays short and recent.
const MAX_PER_CHANNEL_PER_PASS: usize = 3;
/// An unclassified upload this long is treated as a Short, as the
/// subscription feed guesses it.
const SHORT_GUESS_MAX_SECONDS: u64 = 60;

/// The opt-in map from the settings value. A corrupt value disables the
/// feature rather than failing the whole pass.
fn parse_opt_ins(raw: Option<String>) -> HashMap<String, i64> {
    let Some(raw) = raw.filter(|value| !value.trim().is_empty()) else {
        return HashMap::new();
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return HashMap::new();
    };
    let Some(map) = json.as_object() else {
        return HashMap::new();
    };
    map.iter()
        .filter_map(|(channel_id, epoch)| {
            let epoch = epoch
                .as_i64()
                .or_else(|| epoch.as_f64().map(|value| value as i64))?;
            (epoch > 0).then(|| (channel_id.clone(), epoch))
        })
        .collect()
}

/// A channel's uploads, newest first, that this pass may save: published after
/// the opt-in, watchable as a video, and not already saved or in flight.
fn select_candidates(
    uploads: &ChannelUploads,
    opt_in_epoch: i64,
    downloaded: &HashSet<String>,
    in_flight: &HashSet<String>,
) -> Vec<VideoSummary> {
    let mut videos: Vec<(i64, VideoSummary)> = uploads.videos.clone();
    videos.sort_by(|(left, _), (right, _)| right.cmp(left));
    let mut seen = HashSet::new();
    videos
        .into_iter()
        .filter(|(published, video)| {
            *published > opt_in_epoch
                && !video.is_short
                && !video.is_live
                && !video.is_upcoming
                && !video.is_members_only
                && !downloaded.contains(&video.id)
                && !in_flight.contains(&video.id)
                && seen.insert(video.id.clone())
                && !(uploads.unclassified.contains(&video.id)
                    && video
                        .duration_seconds
                        .is_some_and(|seconds| (1..=SHORT_GUESS_MAX_SECONDS).contains(&seconds)))
        })
        .map(|(_, video)| video)
        .take(MAX_PER_CHANNEL_PER_PASS)
        .collect()
}

/// Videos with a queued or paused job: already in the queue, so a pass must not
/// queue them again.
async fn in_flight_video_ids(pool: &SqlitePool) -> Result<HashSet<String>, ErrorResponse> {
    let mut ids = HashSet::new();
    for row in download_jobs::list_jobs(pool)
        .await
        .map_err(ErrorResponse::from)?
    {
        if !matches!(row.status.as_str(), "queued" | "paused") {
            continue;
        }
        if let Ok(request) = serde_json::from_str::<StartDownloadRequest>(&row.request_json) {
            ids.insert(request.video_id);
        }
    }
    Ok(ids)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelAutoDownloadCheck {
    pub candidates: Vec<VideoSummary>,
    pub failed_channel_ids: Vec<String>,
}

/// One pass over the opted-in channels: their newest uploads since opt-in that
/// are not already saved or in flight. The caller queues them through the normal
/// download path, so quality, destination and the queue limit all still apply.
#[tauri::command]
pub async fn check_channel_auto_downloads(
    youtube_service: State<'_, YoutubeService>,
    pool: State<'_, SqlitePool>,
) -> Result<ChannelAutoDownloadCheck, ErrorResponse> {
    let opt_ins = parse_opt_ins(
        settings::get_setting(&pool, AUTO_DOWNLOAD_CHANNELS_KEY)
            .await
            .map_err(ErrorResponse::from)?,
    );
    if opt_ins.is_empty() {
        return Ok(ChannelAutoDownloadCheck {
            candidates: Vec::new(),
            failed_channel_ids: Vec::new(),
        });
    }
    let downloaded: HashSet<String> = downloads::downloaded_video_ids(&pool)
        .await
        .map_err(ErrorResponse::from)?
        .into_iter()
        .collect();
    let in_flight = in_flight_video_ids(&pool).await?;
    let mut candidates = Vec::new();
    let mut failed_channel_ids = Vec::new();
    for (channel_id, opt_in_epoch) in &opt_ins {
        let uploads =
            subscription_feed::fetch_channels(&youtube_service, std::slice::from_ref(channel_id))
                .await;
        if uploads.failed_channel_ids.contains(channel_id) {
            failed_channel_ids.push(channel_id.clone());
            continue;
        }
        candidates.extend(select_candidates(
            &uploads,
            *opt_in_epoch,
            &downloaded,
            &in_flight,
        ));
    }
    Ok(ChannelAutoDownloadCheck {
        candidates,
        failed_channel_ids,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn video(id: &str, seconds: Option<u64>) -> VideoSummary {
        VideoSummary {
            id: id.into(),
            channel_id: Some("UC1".into()),
            duration_seconds: seconds,
            ..VideoSummary::default()
        }
    }

    fn uploads(videos: Vec<(i64, VideoSummary)>, unclassified: &[&str]) -> ChannelUploads {
        ChannelUploads {
            channels: Vec::new(),
            videos,
            failed_channel_ids: Vec::new(),
            unclassified: unclassified.iter().map(|id| id.to_string()).collect(),
        }
    }

    #[test]
    fn opt_ins_keep_only_positive_epochs() {
        let parsed = parse_opt_ins(Some(
            r#"{"UC1": 1700000000, "UC2": 1700000000.9, "UC3": 0, "UC4": -5, "UC5": "soon"}"#
                .into(),
        ));
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed["UC1"], 1_700_000_000);
        assert_eq!(parsed["UC2"], 1_700_000_000);
        assert!(parse_opt_ins(None).is_empty());
        assert!(parse_opt_ins(Some("not json".into())).is_empty());
        assert!(parse_opt_ins(Some("[1, 2]".into())).is_empty());
    }

    #[test]
    fn only_fresh_watchable_uploads_are_candidates() {
        let downloaded: HashSet<String> = ["old".into()].into_iter().collect();
        let in_flight: HashSet<String> = ["busy".into()].into_iter().collect();
        let mut new_video = video("new", Some(600));
        new_video.is_short = false;
        let mut short = video("short", Some(30));
        short.is_short = true;
        let mut live = video("live", Some(0));
        live.is_live = true;
        let mut upcoming = video("soon", None);
        upcoming.is_upcoming = true;
        let mut members = video("members", Some(600));
        members.is_members_only = true;
        let candidates = select_candidates(
            &uploads(
                vec![
                    (100, video("old", Some(600))),
                    (100, video("busy", Some(600))),
                    (100, short),
                    (100, live),
                    (100, upcoming),
                    (100, members),
                    (90, video("stale", Some(600))),
                    (200, new_video),
                ],
                &[],
            ),
            150,
            &downloaded,
            &in_flight,
        );
        assert_eq!(
            candidates
                .iter()
                .map(|video| video.id.as_str())
                .collect::<Vec<_>>(),
            ["new"]
        );
    }

    #[test]
    fn an_unclassified_short_upload_is_left_out() {
        let empty: HashSet<String> = HashSet::new();
        let candidates = select_candidates(
            &uploads(
                vec![
                    (200, video("maybe-short", Some(45))),
                    (190, video("maybe-long", Some(61))),
                    (180, video("no-length", None)),
                ],
                &["maybe-short", "maybe-long", "no-length"],
            ),
            100,
            &empty,
            &empty,
        );
        assert_eq!(
            candidates
                .iter()
                .map(|video| video.id.as_str())
                .collect::<Vec<_>>(),
            ["maybe-long", "no-length"]
        );
    }

    #[test]
    fn three_newest_per_channel_at_most_without_repeats() {
        let empty: HashSet<String> = HashSet::new();
        let candidates = select_candidates(
            &uploads(
                vec![
                    (100, video("a", Some(600))),
                    (400, video("d", Some(600))),
                    (300, video("c", Some(600))),
                    (400, video("d", Some(600))),
                    (200, video("b", Some(600))),
                    (500, video("e", Some(600))),
                ],
                &[],
            ),
            50,
            &empty,
            &empty,
        );
        assert_eq!(
            candidates
                .iter()
                .map(|video| video.id.as_str())
                .collect::<Vec<_>>(),
            ["e", "d", "c"]
        );
    }
}
