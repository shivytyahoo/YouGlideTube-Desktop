//! Names for hidden channels, from the Android app's `BlockedChannelNames` (#1325): a block saves
//! the name it was made with, so a blocked channel keeps its display name.

use std::collections::HashMap;

use sqlx::SqlitePool;

use crate::db::settings::{get_setting, set_setting};
use crate::errors::AppResult;

/// Device-local: not in the settings sync allowlist.
const STORE_KEY: &str = "blocked_channel_names";

/// The names saved when channels were blocked or looked up.
pub async fn stored(pool: &SqlitePool) -> HashMap<String, String> {
    get_setting(pool, STORE_KEY)
        .await
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

async fn save(pool: &SqlitePool, names: &HashMap<String, String>) -> AppResult<()> {
    set_setting(
        pool,
        STORE_KEY,
        &serde_json::to_string(names).unwrap_or_default(),
    )
    .await
}

/// Keeps the name a channel was blocked with.
pub async fn remember(pool: &SqlitePool, channel_id: &str, name: &str) -> AppResult<()> {
    let name = name.trim();
    if channel_id.is_empty() || name.is_empty() {
        return Ok(());
    }
    let mut names = stored(pool).await;
    names.insert(channel_id.to_string(), name.to_string());
    save(pool, &names).await
}

pub async fn forget(pool: &SqlitePool, channel_id: &str) -> AppResult<()> {
    let mut names = stored(pool).await;
    if names.remove(channel_id).is_some() {
        save(pool, &names).await?;
    }
    Ok(())
}
