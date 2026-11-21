//! Shared error type for the local data model and the backup export/import steps.

#[derive(Debug, thiserror::Error)]
pub enum DataError {
    #[error("data: {0}")]
    Protocol(String),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("db: {0}")]
    Db(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

impl From<sqlx::Error> for DataError {
    fn from(e: sqlx::Error) -> Self {
        DataError::Db(e.to_string())
    }
}
