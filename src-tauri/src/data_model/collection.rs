//! A collection's serialized payload, as the backup export writes it and the backup
//! import stages it. (These two shapes used to live in the sync wire protocol.)

use crate::data_model::canonical::Collection;

/// A collection serialized to NDJSON, ready to be written into a backup file.
#[derive(Debug, Clone)]
pub struct OutgoingCollection {
    pub collection: Collection,
    pub ndjson: Vec<u8>,
}

/// A collection read back from a backup file, staged for the apply step.
#[derive(Debug, Clone)]
pub struct StagedCollection {
    pub collection: Collection,
    pub ndjson: Vec<u8>,
    pub record_count: u64,
    pub hash: String,
}

/// The SHA-256 of `data`, hex-encoded. Backup payloads are hashed so a restore can tell
/// whether a collection changed.
pub fn sha256_hex(data: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
