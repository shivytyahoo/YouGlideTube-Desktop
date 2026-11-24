//! The stored brain's size limits and expiries in one place. A merge applies all of
//! them again, since the merged state keeps every entry any device ever had and would
//! otherwise bring back what this device pruned.
//!
//! This is data maintenance for the backup format, not a recommendation engine: nothing
//! here learns, ranks or suggests. The brain is inert stored data now.

use std::collections::{HashMap, HashSet};

use crate::data_model::brain::{
    AFFINITY_KEEP_TOP, AFFINITY_MAX_ENTRIES, CHANNEL_KEEP_HIGH, CHANNEL_KEEP_LOW,
    CHANNEL_PROFILE_MAX_CHANNELS, CHANNEL_SUPPRESSION_DAYS, FEED_HISTORY_EXPIRY_DAYS,
    FEED_HISTORY_MAX, MAX_CHANNEL_SCORES, MAX_SUPPRESSED_CHANNELS, MAX_SUPPRESSED_VIDEOS,
    REJECTION_MEMORY_MAX, RejectionSignal, TOPIC_EVIDENCE_MAX_ENTRIES, TopicEvidence, UserBrain,
    strip_domain_tag,
};
use crate::data_model::brain::{ContentVector, MAX_GLOBAL_TOPICS};

const DAY_MS: u64 = 86_400_000;
const REJECTION_FORGET_BELOW: f64 = 0.5;
const REJECTION_HALF_LIFE_DAYS: f64 = 30.0;
const SEEN_SHORTS_MAX: usize = 3_000;

/// A rejection's effective strength, fading with age.
fn effective_rejections(signal: &RejectionSignal, now_ms: u64) -> f64 {
    #[allow(clippy::cast_precision_loss)]
    let age_days = now_ms.saturating_sub(signal.last_rejected_at) as f64 / 86_400_000.0;
    f64::from(signal.count) * 0.5_f64.powf(age_days / REJECTION_HALF_LIFE_DAYS)
}

/// The preferred-topic keys, protected when the global vector is capped.
fn pick_keys(brain: &UserBrain) -> HashSet<String> {
    let spec = brain.key_spec();
    brain
        .preferred_topics
        .iter()
        .flat_map(|label| spec.keys_of(label))
        .collect()
}

/// Past the cap, the strongest topics stay (protected keys always stay).
fn cap_topics(vector: &ContentVector, max: usize, protected: &HashSet<String>) -> ContentVector {
    if vector.topics.len() <= max {
        return vector.clone();
    }
    let mut ranked: Vec<(&String, f64)> = vector.topics.iter().map(|(k, &v)| (k, v)).collect();
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1));
    let topics = ranked
        .into_iter()
        .enumerate()
        .filter(|(index, (key, _))| *index < max || protected.contains(&strip_domain_tag(key)))
        .map(|(_, (key, weight))| (key.clone(), weight))
        .collect();
    ContentVector {
        topics,
        ..vector.clone()
    }
}

/// Past the cap, the most recently seen Shorts stay.
fn cap_seen(brain: &mut UserBrain) {
    let history = &mut brain.seen_shorts_history;
    if history.len() <= SEEN_SHORTS_MAX {
        return;
    }
    let mut entries: Vec<(String, u64)> = history.drain().collect();
    entries.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    entries.truncate(SEEN_SHORTS_MAX);
    history.extend(entries);
}

/// Keeps the `max` newest entries of a map of timestamps.
fn keep_newest(map: &mut HashMap<String, u64>, max: usize) {
    if map.len() <= max {
        return;
    }
    let mut entries: Vec<(String, u64)> = map.drain().collect();
    entries.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    entries.truncate(max);
    map.extend(entries);
}

pub fn cap_suppressed_videos(brain: &mut UserBrain) {
    keep_newest(&mut brain.suppressed_video_ids, MAX_SUPPRESSED_VIDEOS);
}

/// Past the cap, channel suppressions older than their window go.
pub fn prune_suppressed_channels(brain: &mut UserBrain, now_ms: u64) {
    if brain.suppressed_channels.len() > MAX_SUPPRESSED_CHANNELS {
        let cutoff = now_ms.saturating_sub(CHANNEL_SUPPRESSION_DAYS * DAY_MS);
        brain.suppressed_channels.retain(|_, at| *at >= cutoff);
    }
}

/// Rejections faded below half go; past the cap the oldest make room.
pub fn prune_rejections(patterns: &mut HashMap<String, RejectionSignal>, now_ms: u64) {
    patterns.retain(|_, signal| effective_rejections(signal, now_ms) >= REJECTION_FORGET_BELOW);
    if patterns.len() > REJECTION_MEMORY_MAX {
        let mut oldest: Vec<(String, u64)> = patterns
            .iter()
            .map(|(key, signal)| (key.clone(), signal.last_rejected_at))
            .collect();
        oldest.sort_by_key(|(_, at)| *at);
        let excess = oldest.len() - REJECTION_MEMORY_MAX;
        for (key, _) in oldest.into_iter().take(excess) {
            patterns.remove(&key);
        }
    }
}

/// Showings older than two weeks go; past the cap the oldest make room.
pub fn prune_feed_history(brain: &mut UserBrain, now_ms: u64) {
    let cutoff = now_ms.saturating_sub(FEED_HISTORY_EXPIRY_DAYS * DAY_MS);
    brain
        .feed_history
        .retain(|_, entry| entry.last_shown >= cutoff);
    if brain.feed_history.len() > FEED_HISTORY_MAX {
        let mut entries: Vec<(String, u64)> = brain
            .feed_history
            .iter()
            .map(|(id, entry)| (id.clone(), entry.last_shown))
            .collect();
        entries.sort_by_key(|entry| std::cmp::Reverse(entry.1));
        let kept: HashSet<String> = entries
            .into_iter()
            .take(FEED_HISTORY_MAX)
            .map(|(id, _)| id)
            .collect();
        brain.feed_history.retain(|id, _| kept.contains(id));
    }
}

/// Past the cap, the channels the viewer took to most and least stay; the middle goes.
pub fn cap_channel_scores(brain: &mut UserBrain) {
    if brain.channel_scores.len() <= MAX_CHANNEL_SCORES {
        return;
    }
    let mut sorted: Vec<(String, f64)> = brain.channel_scores.drain().collect();
    sorted.sort_by(|a, b| a.1.total_cmp(&b.1).then_with(|| a.0.cmp(&b.0)));
    let high_from = sorted.len().saturating_sub(CHANNEL_KEEP_HIGH);
    brain.channel_scores = sorted
        .into_iter()
        .enumerate()
        .filter(|(index, _)| *index < CHANNEL_KEEP_LOW || *index >= high_from)
        .map(|(_, entry)| entry)
        .collect();
}

/// Past the cap, the strongest links stay.
pub fn cap_affinities(affinities: &mut HashMap<String, f64>) {
    if affinities.len() <= AFFINITY_MAX_ENTRIES {
        return;
    }
    let mut sorted: Vec<(String, f64)> = affinities.drain().collect();
    sorted.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    sorted.truncate(AFFINITY_KEEP_TOP);
    affinities.extend(sorted);
}

/// Past the cap, the best-supported topics stay.
pub fn cap_evidence(evidence: &mut HashMap<String, TopicEvidence>) {
    if evidence.len() <= TOPIC_EVIDENCE_MAX_ENTRIES {
        return;
    }
    let mut entries: Vec<(String, TopicEvidence)> = evidence.drain().collect();
    entries.sort_by(|a, b| {
        b.1.positive_score
            .total_cmp(&a.1.positive_score)
            .then_with(|| b.1.last_seen_at.cmp(&a.1.last_seen_at))
    });
    entries.truncate(TOPIC_EVIDENCE_MAX_ENTRIES);
    evidence.extend(entries);
}

/// Past the cap, the profiles of the lowest-scored channels go.
pub fn cap_channel_profiles(brain: &mut UserBrain) {
    if brain.channel_topic_profiles.len() <= CHANNEL_PROFILE_MAX_CHANNELS {
        return;
    }
    let scores = &brain.channel_scores;
    let mut channels: Vec<String> = brain.channel_topic_profiles.keys().cloned().collect();
    channels.sort_by(|a, b| {
        let score = |id: &String| scores.get(id).copied().unwrap_or(0.0);
        score(a).total_cmp(&score(b)).then_with(|| a.cmp(b))
    });
    let excess = channels.len() - CHANNEL_PROFILE_MAX_CHANNELS;
    for channel in channels.into_iter().take(excess) {
        brain.channel_topic_profiles.remove(&channel);
    }
}

/// Every limit again, after a merge.
pub fn apply_all(brain: &mut UserBrain, now_ms: u64) {
    cap_suppressed_videos(brain);
    prune_suppressed_channels(brain, now_ms);
    prune_rejections(&mut brain.rejection_patterns, now_ms);
    prune_feed_history(brain, now_ms);
    cap_channel_scores(brain);
    cap_affinities(&mut brain.topic_affinities);
    cap_evidence(&mut brain.topic_evidence);
    cap_channel_profiles(brain);
    cap_seen(brain);
    let picks = pick_keys(brain);
    brain.global_vector = cap_topics(&brain.global_vector, MAX_GLOBAL_TOPICS, &picks);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data_model::brain::FeedEntry;

    #[test]
    fn a_merge_cannot_bring_back_what_this_device_pruned() {
        let now = 1000 * DAY_MS;
        let mut brain = UserBrain::default();
        brain.feed_history.insert(
            "old".into(),
            FeedEntry {
                last_shown: now - 30 * DAY_MS,
                show_count: 1,
            },
        );
        brain.feed_history.insert(
            "new".into(),
            FeedEntry {
                last_shown: now - DAY_MS,
                show_count: 1,
            },
        );
        brain.rejection_patterns.insert(
            "~faded".into(),
            RejectionSignal {
                count: 1,
                last_rejected_at: now - 365 * DAY_MS,
            },
        );
        for i in 0..(MAX_SUPPRESSED_VIDEOS + 10) as u64 {
            brain.suppressed_video_ids.insert(format!("v{i}"), i);
        }
        apply_all(&mut brain, now);
        assert!(brain.feed_history.contains_key("new"));
        assert!(!brain.feed_history.contains_key("old"));
        assert!(brain.rejection_patterns.is_empty());
        assert_eq!(brain.suppressed_video_ids.len(), MAX_SUPPRESSED_VIDEOS);
        assert!(!brain.suppressed_video_ids.contains_key("v0"));
    }
}
