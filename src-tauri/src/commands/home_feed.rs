//! The Home feed: the page asks for a snapshot and reports what is in view; every later change
//! arrives as the `home-feed` event.

use sqlx::SqlitePool;
use tauri::{AppHandle, State};

use crate::db::seen_videos;
use crate::models::video::VideoSummary;
use crate::services::home_feed::chips::{ChipFeed, HomeChips};
use crate::services::home_feed::{HomeFeedService, HomeSnapshot};

#[tauri::command]
pub async fn home_feed_open(
    app: AppHandle,
    home: State<'_, HomeFeedService>,
) -> Result<HomeSnapshot, ()> {
    Ok(home.open(&app).await)
}

#[tauri::command]
pub fn home_feed_refresh(app: AppHandle, home: State<'_, HomeFeedService>) -> HomeSnapshot {
    home.refresh(&app)
}

#[tauri::command]
pub fn home_feed_viewport(app: AppHandle, last_visible: usize, home: State<'_, HomeFeedService>) {
    home.viewport(&app, last_visible);
}

#[tauri::command]
pub fn home_feed_visible(app: AppHandle, visible: bool, home: State<'_, HomeFeedService>) {
    home.set_visible(&app, visible);
}

#[tauri::command]
pub fn home_feed_retry_more(app: AppHandle, home: State<'_, HomeFeedService>) {
    home.retry_more(&app);
}

#[tauri::command]
pub async fn home_feed_clear(app: AppHandle, home: State<'_, HomeFeedService>) -> Result<(), ()> {
    home.clear(&app).await;
    Ok(())
}

/// The chips to offer: which of the fixed ones have anything to show.
#[tauri::command]
pub async fn home_feed_chips(
    app: AppHandle,
    home: State<'_, HomeFeedService>,
) -> Result<HomeChips, ()> {
    Ok(home.chips(&app).await)
}

/// One chip's videos; `refresh` fetches them again.
#[tauri::command]
pub async fn home_chip_feed(
    app: AppHandle,
    key: String,
    refresh: bool,
    home: State<'_, HomeFeedService>,
) -> Result<ChipFeed, ()> {
    Ok(home.chip_feed(&app, &key, refresh).await)
}

/// Counts cards the viewer actually saw: neighbour impressions for the feed, and the seen-set for
/// keeping fresh uploads off the top. (The engine used to learn from these too; it is gone.)
#[tauri::command]
pub async fn record_feed_impressions(
    app: AppHandle,
    videos: Vec<VideoSummary>,
    home: State<'_, HomeFeedService>,
    pool: State<'_, SqlitePool>,
) -> Result<(), ()> {
    let ids: Vec<String> = videos.iter().map(|video| video.id.clone()).collect();
    home.note_impressions(&app, &ids).await;
    let now = chrono::Utc::now().timestamp_millis();
    let _ = seen_videos::remember(&pool, &ids, now).await;
    Ok(())
}
