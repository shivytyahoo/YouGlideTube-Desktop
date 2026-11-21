//! Builds a backup file's contents from the app's database.

use std::collections::HashMap;
use std::path::Path;

use serde::Deserialize;
use serde_json::{Map, Value, json};
use sqlx::SqlitePool;

use crate::backup::android_brain::{music_brain_to_android, user_brain_to_android};
use crate::backup::app_data::{AppDataParts, to_app_data};
use crate::backup::archive::{Archive, Slice};
use crate::commands::backup::{
    BackupExport, RECAP_STATS_ENTRY, export_backup, get_setting_value, raw_settings,
};
use crate::data_model::brain::UserBrain;
use crate::data_model::music_brain::MusicBrain;
use crate::recap::model::RecapBackup;
use crate::data_model::apply::{MUSIC_BRAIN_KEY, NEURO_BRAIN_KEY};
use crate::data_model::brain_rekey::align_flow;
use crate::data_model::error::DataError;
use crate::data_model::merge::MergedFlowNeuroBrain;

#[must_use]
pub fn now_ms() -> u64 {
    chrono::Utc::now().timestamp_millis().max(0).cast_unsigned()
}

fn iso_now(now: u64) -> String {
    chrono::DateTime::from_timestamp_millis(i64::try_from(now).unwrap_or(0))
        .unwrap_or_default()
        .to_rfc3339()
}

async fn stored_brain(pool: &SqlitePool) -> Result<Option<UserBrain>, DataError> {
    let Some(raw) = get_setting_value(pool, NEURO_BRAIN_KEY).await? else {
        return Ok(None);
    };
    let Ok(mut brain) = serde_json::from_str::<UserBrain>(&raw) else {
        return Ok(None);
    };
    align_flow(Some(&mut brain), &mut MergedFlowNeuroBrain::default(), None);
    Ok(Some(brain))
}

async fn stored_music(pool: &SqlitePool) -> Result<Option<MusicBrain>, DataError> {
    let Some(raw) = get_setting_value(pool, MUSIC_BRAIN_KEY).await? else {
        return Ok(None);
    };
    Ok(serde_json::from_str(&raw).ok())
}

/// The ledger leaves the export for its own entry, where Android reads it, so a file holds it once.
/// One that never started stays out: Android would replace the phone's with it.
fn take_recap(collections: &mut Map<String, Value>) -> Option<Value> {
    let Value::Array(mut ledgers) = collections.remove(RECAP_STATS_ENTRY)? else {
        return None;
    };
    let ledger = ledgers.pop()?;
    RecapBackup::deserialize(&ledger)
        .is_ok_and(|backup| !backup.never_started())
        .then_some(ledger)
}

fn desktop_section(export: &BackupExport, settings: &HashMap<String, String>, now: u64) -> Value {
    json!({
        "schemaVersion": 2,
        "app": { "name": "YouGlideTube", "version": env!("CARGO_PKG_VERSION") },
        "exportedAt": iso_now(now),
        "scope": export.scope,
        "settings": settings,
        "collections": export.collections,
        "deviceId": export.device_id,
    })
}

/// One slice's files. `scope` is `MASTER`, `APP_DATA` or `BRAIN`; each writes only what it covers.
pub async fn build_slice(
    pool: &SqlitePool,
    scope: &str,
    setting_keys: &[String],
    now: u64,
) -> Result<Slice, DataError> {
    let mut export = export_backup(pool, scope).await?;
    let recap = take_recap(&mut export.collections);
    let is_brain_only = scope == "BRAIN";
    let settings = if is_brain_only {
        HashMap::new()
    } else {
        raw_settings(pool, setting_keys).await?
    };
    let brain = stored_brain(pool).await?;
    let content_preferences = if is_brain_only {
        None
    } else {
        brain.as_ref().map(|brain| {
            json!({
                "preferredTopics": brain.preferred_topics,
                "blockedTopics": brain.blocked_topics,
                "blockedChannels": brain.blocked_channels,
            })
        })
    };
    let app_data = to_app_data(AppDataParts {
        collections: &export.collections,
        settings: (!is_brain_only).then_some(&settings),
        content_preferences,
        desktop: desktop_section(&export, &settings, now),
        now_ms: now,
    });
    let with_brains = scope != "APP_DATA";
    Ok(Slice {
        app_data,
        engine: brain
            .filter(|_| with_brains)
            .map(|brain| user_brain_to_android(&brain)),
        music: stored_music(pool)
            .await?
            .filter(|_| with_brains)
            .map(|music| music_brain_to_android(&music)),
        recap,
    })
}

/// A zip holding the library's brains, restorable as a master backup on either app.
pub async fn brain_archive(pool: &SqlitePool, now: u64) -> Result<Archive, DataError> {
    Ok(Archive {
        root: build_slice(pool, "BRAIN", &[], now).await?,
        manifest: None,
        profiles: Vec::new(),
        avatars: Vec::new(),
    })
}

/// The whole library in one slice. The manifest stays so older builds (and Android) still
/// recognise the file as a master backup; its `profiles` list is empty because there is only
/// one library now, and its data stays at the top level where older builds read it.
pub async fn master_archive(
    pool: &SqlitePool,
    setting_keys: &[String],
    now: u64,
) -> Result<Archive, DataError> {
    let root = build_slice(pool, "MASTER", setting_keys, now).await?;
    Ok(Archive {
        root,
        manifest: Some(json!({
            "format": "youglidetube-master",
            "version": 1,
            "defaultId": "default",
            "profiles": [],
            "included": ["default"],
        })),
        profiles: Vec::new(),
        avatars: Vec::new(),
    })
}

/// Writes one backup to `path`, as a zip or as JSON by its scope. Callers flush the resident
/// brains first.
pub async fn write_backup(
    pool: &SqlitePool,
    scope: &str,
    setting_keys: &[String],
    path: &Path,
) -> Result<(), DataError> {
    let now = now_ms();
    let target = path.to_path_buf();
    let io_error = |error: std::io::Error| DataError::Protocol(format!("backup write: {error}"));
    match scope {
        "APP_DATA" => {
            let slice = build_slice(pool, scope, setting_keys, now).await?;
            run_blocking(move || crate::backup::archive::write_json(&target, &slice.app_data))
                .await
                .map_err(io_error)
        }
        "BRAIN" => {
            let archive = brain_archive(pool, now).await?;
            run_blocking(move || crate::backup::archive::write_archive(&target, &archive))
                .await
                .map_err(io_error)
        }
        "MASTER" => {
            let archive = master_archive(pool, setting_keys, now).await?;
            run_blocking(move || crate::backup::archive::write_archive(&target, &archive))
                .await
                .map_err(io_error)
        }
        other => Err(DataError::Protocol(format!(
            "unknown backup scope: {other}"
        ))),
    }
}

/// Compressing a whole history takes seconds, which must not hold up an async worker.
async fn run_blocking(
    work: impl FnOnce() -> std::io::Result<()> + Send + 'static,
) -> std::io::Result<()> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(std::io::Error::other)?
}
