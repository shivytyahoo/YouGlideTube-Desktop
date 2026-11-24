use crate::errors::{AppError, AppResult};
use sqlx::SqlitePool;

pub async fn set_setting(pool: &SqlitePool, key: &str, value: &str) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET 
            value = excluded.value,
            updated_at = CURRENT_TIMESTAMP",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await
    .map_err(AppError::from)?;

    Ok(())
}

pub async fn get_setting(pool: &SqlitePool, key: &str) -> AppResult<Option<String>> {
    let row = sqlx::query("SELECT value FROM settings WHERE key = ? LIMIT 1")
        .bind(key)
        .fetch_optional(pool)
        .await
        .map_err(AppError::from)?;

    if let Some(r) = row {
        let value: String = sqlx::Row::get(&r, 0);
        Ok(Some(value))
    } else {
        Ok(None)
    }
}

#[allow(dead_code)]
pub async fn clear_settings(pool: &SqlitePool) -> AppResult<()> {
    sqlx::query("DELETE FROM settings")
        .execute(pool)
        .await
        .map_err(AppError::from)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn memory() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn settings_round_trip_in_the_single_database() {
        let pool = memory().await;
        set_setting(&pool, "download_location", "/media")
            .await
            .unwrap();
        set_setting(&pool, "theme_id", "ocean").await.unwrap();
        assert_eq!(
            get_setting(&pool, "download_location")
                .await
                .unwrap()
                .as_deref(),
            Some("/media")
        );
        assert_eq!(
            get_setting(&pool, "theme_id").await.unwrap().as_deref(),
            Some("ocean")
        );
        assert_eq!(get_setting(&pool, "missing_key").await.unwrap(), None);
        set_setting(&pool, "theme_id", "forest").await.unwrap();
        assert_eq!(
            get_setting(&pool, "theme_id").await.unwrap().as_deref(),
            Some("forest")
        );
    }
}
