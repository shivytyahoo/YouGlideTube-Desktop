//! Cross-platform tolerance tests for the backup data model.
//!
//! These lock the FlowNeuro brain envelope Flow for Android actually sends (issue #46).
//! The Android payloads below are shaped exactly as `sync/canonical/Canonical.kt` +
//! `sync/mapping/BrainMapper.kt` serialize them. The LAN-address half of this file died with
//! the P2P sync engine.
//!
//! They live in an integration test for the same reason as `sync_crdt.rs`: the in-crate unit-test
//! harness fails to launch on Windows against Tauri's cdylib.

use youglidetube_desktop_lib::data_model::canonical::{FlowNeuroBrainSnapshot, GCounter, Hlc, Lww, OrSet};
use youglidetube_desktop_lib::data_model::merge::merge_flow_neuro;

const ANDROID_DEVICE: &str = "d68ec770-8084-4f42-9914-132eca886f13";
const ANDROID_HLC: &str = "1784462799000:0:d68ec770";

/// One `flow_neuro_brain` NDJSON record exactly as Flow for Android v2.2.0 emits it: counters,
/// per-video maps, sets, LWW-maps and flags all at the top level, G-Counters wrapped in
/// `perDevice`, vector dimensions inline, and no stamps on the sets/registers.
fn android_brain_record() -> String {
    format!(
        r#"{{
          "schema": 13,
          "deviceId": "{ANDROID_DEVICE}",
          "hlc": "{ANDROID_HLC}",
          "vectors": {{
            "globalVector": {{"topics":{{"music":0.8}},"duration":0.5,"pacing":0.4,"complexity":0.6,"isLive":0.0}},
            "timeVectors": {{"WEEKDAY_EVENING":{{"topics":{{"music":0.9}},"duration":0.5,"pacing":0.5,"complexity":0.5,"isLive":0.0}}}},
            "shortsVector": {{"topics":{{}},"duration":0.5,"pacing":0.5,"complexity":0.5,"isLive":0.0}},
            "topicAffinities": {{"music":0.7}},
            "channelScores": {{"UC123":0.6}},
            "channelTopicProfiles": {{"UC123":{{"music":0.9}}}}
          }},
          "idfTotalDocuments": {{"perDevice":{{"{ANDROID_DEVICE}":42}}}},
          "totalInteractions": {{"perDevice":{{"{ANDROID_DEVICE}":17}}}},
          "idfWordFrequency": {{"music":{{"perDevice":{{"{ANDROID_DEVICE}":3}}}}}},
          "watchHistoryMap": {{"vid1":0.75}},
          "seenShortsHistory": {{"short1":1784462799000}},
          "suppressedVideoIds": {{"vidbad":1784462799000}},
          "suppressedChannels": {{"UCbad":1784462799000}},
          "rejectionPatterns": {{"clickbait":{{"count":2,"lastRejectedAt":1784462799000}}}},
          "feedHistory": {{"vid1":{{"lastShown":1784462799000,"showCount":3}}}},
          "topicEvidence": {{"music":{{"positiveSignals":4,"watchSignals":3,"explicitSignals":1,"positiveScore":0.8,"videoIds":["vid1"],"channelIds":["UC123"],"firstSeenAt":1,"lastSeenAt":2}}}},
          "blockedTopics": ["politics"],
          "blockedChannels": ["UCblocked"],
          "preferredTopics": ["music"],
          "hasCompletedOnboarding": true
        }}"#
    )
}

// ---- G-Counter -------------------------------------------------------------------------------

#[test]
fn gcounter_accepts_both_the_canonical_map_and_androids_per_device_wrapper() {
    let canonical: GCounter = serde_json::from_str(r#"{"dev-a":12,"dev-b":30}"#).unwrap();
    let wrapped: GCounter =
        serde_json::from_str(r#"{"perDevice":{"dev-a":12,"dev-b":30}}"#).unwrap();
    assert_eq!(canonical, wrapped);
    assert_eq!(canonical.total(), 42);
    assert_eq!(canonical.get("dev-a"), 12);
}

#[test]
fn gcounter_still_serializes_as_the_bare_map() {
    let counter = GCounter::single("dev-a", 7);
    assert_eq!(serde_json::to_string(&counter).unwrap(), r#"{"dev-a":7}"#);
}

// ---- OR-Set / LWW ------------------------------------------------------------------------------

#[test]
fn orset_accepts_a_bare_member_array() {
    let from_array: OrSet = serde_json::from_str(r#"["music","tech"]"#).unwrap();
    assert!(from_array.contains("music"));
    assert!(from_array.contains("tech"));
    assert!(!from_array.contains("politics"));
    assert!(from_array.removes.is_empty());

    // The canonical stamped form is unchanged.
    let stamped: OrSet =
        serde_json::from_str(r#"{"adds":{"music":"5:0:aaaa"},"removes":{"music":"9:0:bbbb"}}"#)
            .unwrap();
    assert!(!stamped.contains("music"), "a later remove must win");
}

#[test]
fn lww_accepts_a_bare_value_and_the_stamped_register() {
    let bare: Lww<u64> = serde_json::from_str("1784462799000").unwrap();
    assert_eq!(bare.value, 1_784_462_799_000);
    assert_eq!(bare.hlc, Hlc::default());

    let stamped: Lww<u64> =
        serde_json::from_str(r#"{"value":1784462799000,"hlc":"5:0:aaaa"}"#).unwrap();
    assert_eq!(stamped.value, 1_784_462_799_000);
    assert_eq!(stamped.hlc, Hlc::new(5, 0, "aaaa"));
}

// ---- The brain snapshot ------------------------------------------------------------------------

#[test]
fn androids_flat_brain_envelope_parses_instead_of_aborting_the_apply() {
    // Before the compat layer this failed with `invalid type: map, expected u64`, which rolled back
    // the whole apply transaction — so nothing synced at all whenever the brain was selected.
    let snapshot: FlowNeuroBrainSnapshot =
        serde_json::from_str(&android_brain_record()).expect("android brain record must parse");

    assert_eq!(snapshot.schema, 13);
    assert_eq!(snapshot.device_id, ANDROID_DEVICE);
    assert_eq!(snapshot.hlc, Hlc::new(1_784_462_799_000, 0, "d68ec770"));
}

#[test]
fn androids_top_level_fields_land_in_their_grouped_homes() {
    let snapshot: FlowNeuroBrainSnapshot = serde_json::from_str(&android_brain_record()).unwrap();

    // counters / idf words
    assert_eq!(
        snapshot.counters.idf_total_documents.get(ANDROID_DEVICE),
        42
    );
    assert_eq!(snapshot.counters.total_interactions.total(), 17);
    assert_eq!(snapshot.idf_word_frequency["music"].total(), 3);

    // perVideo
    assert_eq!(snapshot.per_video.watch_history_map["vid1"], 0.75);

    // sets
    assert!(snapshot.sets.blocked_topics.contains("politics"));
    assert!(snapshot.sets.blocked_channels.contains("UCblocked"));
    assert!(snapshot.sets.preferred_topics.contains("music"));

    // lwwMaps
    assert_eq!(
        snapshot.lww_maps.suppressed_video_ids["vidbad"].value,
        1_784_462_799_000
    );
    assert_eq!(
        snapshot.lww_maps.suppressed_channels["UCbad"].value,
        1_784_462_799_000
    );
    assert_eq!(
        snapshot.lww_maps.rejection_patterns["clickbait"]
            .value
            .count,
        2
    );
    assert_eq!(snapshot.lww_maps.feed_history["vid1"].value.show_count, 3);
    let evidence = &snapshot.lww_maps.topic_evidence["music"].value;
    assert_eq!(evidence.positive_signals, 4);
    assert_eq!(evidence.watch_signals, 3);
    assert!(evidence.video_ids.contains("vid1"));

    // flags
    assert!(snapshot.flags.has_completed_onboarding);
}

#[test]
fn androids_inline_vector_dimensions_are_folded_into_dims() {
    let snapshot: FlowNeuroBrainSnapshot = serde_json::from_str(&android_brain_record()).unwrap();

    let global = &snapshot.vectors.global_vector;
    assert_eq!(global.topics["music"], 0.8);
    assert_eq!(global.dims["duration"], 0.5);
    assert_eq!(global.dims["pacing"], 0.4);
    assert_eq!(global.dims["complexity"], 0.6);
    assert_eq!(global.dims["isLive"], 0.0);
    assert!(snapshot.vectors.shorts_vector.is_some());
}

#[test]
fn androids_screaming_snake_bucket_keys_are_rewritten_on_ingest() {
    // Android keys its time vectors by the Kotlin enum name. Rewriting must happen here, at the
    // decode boundary — left alone, `WEEKDAY_EVENING` and our `WeekdayEvening` survive as two
    // distinct keys through the whole CRDT merge and never blend.
    let snapshot: FlowNeuroBrainSnapshot = serde_json::from_str(&android_brain_record()).unwrap();

    assert_eq!(
        snapshot.vectors.time_vectors["WeekdayEvening"].topics["music"],
        0.9
    );
    assert!(
        !snapshot
            .vectors
            .time_vectors
            .contains_key("WEEKDAY_EVENING")
    );
}

#[test]
fn an_already_canonical_bucket_key_wins_a_collision() {
    let raw = r#"{"vectors":{"timeVectors":{
        "WEEKDAY_EVENING":{"topics":{"music":0.9}},
        "WeekdayEvening":{"topics":{"coding":0.3}}
    }}}"#;
    let snapshot: FlowNeuroBrainSnapshot = serde_json::from_str(raw).unwrap();

    assert_eq!(snapshot.vectors.time_vectors.len(), 1);
    assert_eq!(
        snapshot.vectors.time_vectors["WeekdayEvening"].topics["coding"],
        0.3
    );
}

#[test]
fn an_unrecognized_bucket_key_is_passed_through_rather_than_dropped() {
    let raw = r#"{"vectors":{"timeVectors":{"SomeFutureBucket":{"topics":{"music":0.9}}}}}"#;
    let snapshot: FlowNeuroBrainSnapshot = serde_json::from_str(raw).unwrap();

    assert_eq!(
        snapshot.vectors.time_vectors["SomeFutureBucket"].topics["music"],
        0.9
    );
}

#[test]
fn unstamped_sets_and_registers_inherit_the_snapshot_hlc() {
    // Left at the zero stamp they would lose every merge against a local write, and an old remove
    // tombstone would silently un-block a channel the user just blocked on the phone.
    let snapshot: FlowNeuroBrainSnapshot = serde_json::from_str(&android_brain_record()).unwrap();
    let expected = Hlc::new(1_784_462_799_000, 0, "d68ec770");

    assert_eq!(snapshot.sets.blocked_topics.adds["politics"], expected);
    assert_eq!(snapshot.sets.blocked_channels.adds["UCblocked"], expected);
    assert_eq!(
        snapshot.lww_maps.suppressed_video_ids["vidbad"].hlc,
        expected
    );
    assert_eq!(snapshot.lww_maps.feed_history["vid1"].hlc, expected);
    assert_eq!(snapshot.lww_maps.topic_evidence["music"].hlc, expected);
}

#[test]
fn an_android_snapshot_carries_its_experience_weight_into_the_merge() {
    // The blend weights each device by its idf document count; if the counter had stayed at the
    // top level it would read as 0 and the phone's learned vectors would count for nothing.
    let snapshot: FlowNeuroBrainSnapshot = serde_json::from_str(&android_brain_record()).unwrap();
    let merged = merge_flow_neuro(&[snapshot]);

    let device = &merged.device_vectors[ANDROID_DEVICE];
    assert_eq!(device.weight, 42);
    assert_eq!(merged.counters.total_interactions.total(), 17);
    assert!(merged.sets.blocked_topics.contains("politics"));
}

#[test]
fn the_canonical_grouped_envelope_still_round_trips_byte_for_byte() {
    // Desktop→desktop sync and the persisted merged-brain blob both depend on this.
    let snapshot: FlowNeuroBrainSnapshot = serde_json::from_str(&android_brain_record()).unwrap();
    let canonical = serde_json::to_string(&snapshot).unwrap();
    let reparsed: FlowNeuroBrainSnapshot = serde_json::from_str(&canonical).unwrap();

    assert_eq!(snapshot, reparsed);
    assert_eq!(canonical, serde_json::to_string(&reparsed).unwrap());
    // And the emitted form is the grouped one, not what we accepted.
    assert!(canonical.contains(r#""counters":{"idfTotalDocuments":{""#));
    assert!(canonical.contains(r#""lwwMaps":"#));
    assert!(!canonical.contains("perDevice"));
}

