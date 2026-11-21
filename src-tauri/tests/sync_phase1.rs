//! isolation tests for device identity / HLC. These run in an integration test (the crate links
//! Tauri's cdylib; in-crate unit tests can't launch on Windows — see the note in
//! `src/data_model/canonical.rs`). The payload-crypto and QR-handshake tests died with the
//! P2P sync engine.

use youglidetube_desktop_lib::data_model::canonical::{Hlc, short_device_id};
use youglidetube_desktop_lib::data_model::identity::{default_device_name, new_device_id};

// --------------------------------------------------------------------------------------------
// Identity & HLC
// --------------------------------------------------------------------------------------------

#[test]
fn device_ids_are_unique_and_name_is_friendly() {
    assert_ne!(new_device_id(), new_device_id());
    assert!(default_device_name().starts_with("the desktop app ("));
}

#[test]
fn hlc_uses_the_short_device_id_form() {
    // `<physicalMs>:<counter>:<deviceIdShort>`, deviceIdShort = first 8 hyphenless lowercase chars.
    let h = Hlc::new(1_700_000_000_000, 3, "75DBC20B-69FA-4DD7-9CD2-C169DCD17749");
    assert_eq!(h.device_id, "75dbc20b");
    assert_eq!(h.to_string(), "1700000000000:3:75dbc20b");
    // Round-trips, and parsing normalizes a non-conformant full id to the same short form.
    let parsed: Hlc = "1700000000000:3:75dbc20b".parse().unwrap();
    assert_eq!(parsed, h);
    assert_eq!(
        short_device_id("ab"),
        "ab",
        "ids shorter than 8 are kept as-is"
    );
}

