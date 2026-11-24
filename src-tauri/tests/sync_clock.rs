//! The hybrid clock: a local edit made after applying a record stamped by a clock that runs ahead
//! is still stamped later, and the high-water mark survives a restart.

#[path = "common/mod.rs"]
mod common;

use common::local_edits;
use serde_json::json;
use sqlx::SqlitePool;

use youglidetube_desktop_lib::data_model::apply::apply_payload;
use youglidetube_desktop_lib::data_model::canonical::Collection;
use youglidetube_desktop_lib::data_model::clock;
use youglidetube_desktop_lib::data_model::collection::StagedCollection;

const DAY_MS: u64 = 24 * 60 * 60 * 1000;

/// A file-backed database in `dir`, migrated, as the app opens it.
async fn open_test_db(dir: &std::path::Path) -> SqlitePool {
    std::fs::create_dir_all(dir).unwrap();
    // sqlx does NOT create a missing database file by default
    // (`create_if_missing` is false), so opening a fresh path fails with
    // SQLITE_CANTOPEN ("unable to open database file"). Pass the path
    // directly and opt into creation, as the app itself does in db/mod.rs.
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(dir.join("youglidetube.sqlite"))
        .create_if_missing(true);
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    pool
}

/// Applies a like stamped a day ahead of this device's clock, and returns that stamp's time.
async fn apply_like_from_the_future(pool: &SqlitePool) -> u64 {
    let ahead = u64::try_from(chrono::Utc::now().timestamp_millis()).unwrap() + DAY_MS;
    let like = json!({
        "kind": "video", "id": "vid1", "state": "liked", "updatedAtMs": ahead,
        "hlc": format!("{ahead}:0:a1b2c3d4"), "meta": {},
        "title": "Liked ahead", "channelName": "", "thumbnailUrl": ""
    });
    let ndjson = serde_json::to_vec(&like).unwrap();
    let staged = StagedCollection {
        collection: Collection::Likes,
        hash: "ahead".into(),
        record_count: 1,
        ndjson,
    };
    apply_payload(pool, "ddesk", "dpeer", &[staged])
        .await
        .unwrap();
    ahead
}

#[tokio::test]
async fn an_edit_after_a_record_from_a_clock_ahead_is_stamped_later() {
    let dir = std::env::temp_dir().join(format!("youglidetube-clock-{}", uuid::Uuid::new_v4()));
    let pool = open_test_db(&dir).await;
    let ahead = apply_like_from_the_future(&pool).await;

    local_edits::record_blob_write(&pool, "liked_items", "[]")
        .await
        .unwrap();
    let stamped: i64 = sqlx::query_scalar(
        "SELECT changed_at_ms FROM sync_changes WHERE collection = 'likes' AND deleted = 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(u64::try_from(stamped).unwrap() > ahead);
    pool.close().await;
    std::fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn the_clock_keeps_what_it_saw_across_a_restart() {
    let dir = std::env::temp_dir().join(format!("youglidetube-clock-{}", uuid::Uuid::new_v4()));
    let pool = open_test_db(&dir).await;
    let ahead = apply_like_from_the_future(&pool).await;
    pool.close().await;

    let reopened = open_test_db(&dir).await;
    assert_eq!(clock::edit_ms(&reopened).await.unwrap(), ahead + 1);
    reopened.close().await;
    std::fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn a_stamp_at_the_end_of_time_still_lets_this_device_edit() {
    let dir = std::env::temp_dir().join(format!("youglidetube-clock-{}", uuid::Uuid::new_v4()));
    let pool = open_test_db(&dir).await;
    clock::observe(&mut pool.acquire().await.unwrap(), u64::MAX)
        .await
        .unwrap();
    assert_eq!(clock::edit_ms(&pool).await.unwrap(), u64::MAX);
    pool.close().await;
    std::fs::remove_dir_all(dir).unwrap();
}
