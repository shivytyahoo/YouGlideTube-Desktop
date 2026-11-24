//! golden vectors — the shared anti-drift gate between the desktop (Rust) and Android (Kotlin)
//! implementations. Each fixture under `tests/fixtures/flow-sync/` pins an input → expected-output
//! pair for one primitive (canonical JSON). Both repos check in the SAME fixtures and assert
//! equality; a divergence in the serializer fails CI here before it can corrupt a live
//! cross-platform restore. The HKDF/SAS/AES-GCM vectors died with the P2P sync engine.

use std::path::PathBuf;

use serde_json::Value;
use youglidetube_desktop_lib::data_model::canonical::to_canonical_json;

fn fixture(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/flow-sync")
        .join(name);
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("read fixture {}: {e}", path.display()));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("parse fixture {name}: {e}"))
}

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k)
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("fixture missing string `{k}`"))
}

#[test]
fn canonical_json_matches_the_golden_vector() {
    let f = fixture("canonical_json.json");
    let input = f.get("input").expect("fixture has input");
    let out = String::from_utf8(to_canonical_json(input)).unwrap();
    assert_eq!(out, s(&f, "expected"), "canonical JSON key-ordering drift");
}

/// Android's `SyncSerialization.encodeNotes`: every field present, nulls included, keys sorted.
#[test]
fn a_note_matches_android_s_canonical_bytes() {
    let line = r#"{"channelAvatarUrl":null,"channelHandle":null,"channelId":"UCx","channelName":"A channel","deleted":false,"durationSeconds":754,"id":"video:abc123def45","kind":"Video","subscriberCountText":null,"targetId":"abc123def45","text":"12:34 the good part","thumbnailUrl":null,"title":"A video","updatedAt":1700000000000}"#;
    let note: youglidetube_desktop_lib::data_model::canonical::Note =
        serde_json::from_str(line).unwrap();
    assert_eq!(String::from_utf8(to_canonical_json(&note)).unwrap(), line);
}
