use crate::data_model::display_forms::DisplayForms;
use crate::data_model::keyspec;
use chrono::{Datelike, Local, Timelike, Weekday};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};

pub const SCHEMA_VERSION: i32 = 14;

/// The global vector keeps at most this many topics after a merge.
pub const MAX_GLOBAL_TOPICS: usize = 300;

#[allow(dead_code)]
pub const CHANNEL_BOREDOM_MULTIPLIER: f64 = 0.5;
#[allow(dead_code)]
pub const CHANNEL_BOREDOM_THRESHOLD: f64 = 0.05;
pub const CHANNEL_EMA_ALPHA: f64 = 0.05;
pub const CHANNEL_EMA_DECAY: f64 = 1.0 - CHANNEL_EMA_ALPHA;
/// A thumbs-down halves the channel's score; it never hides the channel.
pub const DISLIKE_CHANNEL_FACTOR: f64 = 0.5;
pub const MAX_CHANNEL_SCORES: usize = 500;
pub const CHANNEL_KEEP_LOW: usize = 50;
pub const CHANNEL_KEEP_HIGH: usize = 200;
pub const CHANNEL_PROFILE_LEARNING_RATE: f64 = 0.10;
pub const CHANNEL_PROFILE_MAX_TOPICS: usize = 15;
pub const CHANNEL_PROFILE_PRUNE_THRESHOLD: f64 = 0.05;
pub const CHANNEL_PROFILE_MAX_CHANNELS: usize = 200;
pub const CHANNEL_PROFILE_BLEND_WEIGHT: f64 = 0.30;
/// A channel known from fewer topics than this lends a bare title none of them.
pub const CHANNEL_PROFILE_MIN_VIDEOS: usize = 3;

pub const TOPIC_PRUNE_THRESHOLD: f64 = 0.03;
pub const ESTABLISHED_TOPIC_THRESHOLD: f64 = 0.30;
pub const DEVELOPING_TOPIC_THRESHOLD: f64 = 0.10;
pub const ESTABLISHED_DECAY_RATE: f64 = 0.998;
pub const DEVELOPING_DECAY_RATE: f64 = 0.993;
pub const EMERGING_DECAY_RATE: f64 = 0.97;

pub const MAX_CONSECUTIVE_SKIPS: i32 = 30;

pub const COLD_START_THRESHOLD: i32 = 30;
pub const ONBOARDING_WARMUP_INTERACTIONS: i32 = 50;

#[allow(dead_code)]
pub const ENGAGEMENT_RATE_BASELINE: f64 = 0.05;
#[allow(dead_code)]
pub const ENGAGEMENT_MAX_BOOST: f64 = 0.05;
#[allow(dead_code)]
pub const ENGAGEMENT_MIN_VIEWS: u64 = 1000;

#[allow(dead_code)]
pub const ENGAGEMENT_FLOOR_RATE: f64 = 0.01;
#[allow(dead_code)]
pub const ENGAGEMENT_FLOOR_MIN_VIEWS: u64 = 50_000;
#[allow(dead_code)]
pub const ENGAGEMENT_FLOOR_PENALTY: f64 = 0.2;

#[allow(dead_code)]
pub const FEATURE_CACHE_MAX: usize = 150;
pub const IDF_MIN_WEIGHT: f64 = 0.15;
// Hard cap on distinct IDF vocabulary (the one otherwise-unbounded brain structure); when
// exceeded, keep the highest-frequency (most informative) terms.
pub const IDF_MAX_KEYS: usize = 20_000;
pub const IDF_KEEP_KEYS: usize = 15_000;

pub const SESSION_TOPIC_HISTORY_MAX: usize = 50;

pub const AFFINITY_INCREMENT: f64 = 0.03;
/// A watch links each pair of its strongest topics.
pub const AFFINITY_TOP_TOPICS: usize = 3;
/// What a strong signal plants its top topics at, so a new interest survives its first weeks.
pub const TOPIC_ACQUISITION_FLOOR: f64 = 0.05;
pub const TOPIC_ACQUISITION_TOP_K: usize = 3;
pub const AFFINITY_MAX: f64 = 1.0;
pub const AFFINITY_MAX_ENTRIES: usize = 500;
pub const AFFINITY_KEEP_TOP: usize = 300;

pub const TOPIC_SIMILARITY_WEIGHT: f64 = 0.70;
pub const DURATION_SIMILARITY_WEIGHT: f64 = 0.10;
pub const PACING_SIMILARITY_WEIGHT: f64 = 0.10;
pub const COMPLEXITY_SIMILARITY_WEIGHT: f64 = 0.10;
// When two vectors share no topic, similarity comes only from duration/pacing/complexity. Damp it
// hard so off-topic content cannot float above the relevance floor on scalar coincidence alone.
pub const SCALAR_ONLY_DAMP: f64 = 0.3;

pub const NEGATIVE_PROPORTIONAL_EXPONENT: f64 = 1.5;
pub const NEGATIVE_FLOOR_FACTOR: f64 = 0.3;
pub const NEGATIVE_SCALAR_PROPORTIONAL: f64 = 0.3;
pub const NEGATIVE_SCALAR_FLOOR: f64 = 0.1;
pub const COMPRESSION_THRESHOLD: f64 = 0.6;
pub const COMPRESSION_CEILING: f64 = 0.5;
pub const COMPRESSION_FACTOR: f64 = 0.7;

pub const COMPLEXITY_TITLE_LEN_MAX: f64 = 80.0;
pub const COMPLEXITY_TITLE_LEN_WEIGHT: f64 = 0.4;
pub const COMPLEXITY_WORD_LEN_DIVISOR: f64 = 8.0;
pub const COMPLEXITY_WORD_LEN_WEIGHT: f64 = 0.4;
pub const COMPLEXITY_CHAPTER_BONUS: f64 = 0.2;

pub const DESCRIPTION_MIN_LENGTH: usize = 20;
pub const DESCRIPTION_TAKE_WORDS: usize = 15;
pub const DESCRIPTION_TAKE_LINES: usize = 5;
pub const DESCRIPTION_LINE_MIN_LENGTH: usize = 15;
pub const DESCRIPTION_WORD_WEIGHT: f64 = 0.2;

pub const CHANNEL_KEYWORD_WEIGHT: f64 = 0.6;
pub const TITLE_KEYWORD_WEIGHT: f64 = 0.5;
pub const BIGRAM_PRIORITY_WEIGHT: f64 = 1.2;

pub const PERSONA_STABILITY_THRESHOLD: i32 = 3;
pub const PERSONA_MAX_STABILITY: i32 = 10;

// Impression fatigue
pub const IMPRESSION_CACHE_MAX: usize = 500;

// Watched History already-watched penalties
pub const WATCH_HISTORY_MAX: usize = 2000;
pub const WATCHED_THRESHOLD_SAMPLED: f32 = 0.15;
pub const WATCHED_THRESHOLD_FULL: f32 = 0.85;

/// Longest a video can be and still count as a Short.
pub const SHORT_MAX_SECONDS: u64 = 60;

/// A Short only when its length is known: an unknown length is not a guess at one.
pub fn is_known_short(duration_seconds: Option<u64>) -> bool {
    duration_seconds.is_some_and(|seconds| seconds > 0 && seconds <= SHORT_MAX_SECONDS)
}
pub const CHANNEL_SUPPRESSION_DAYS: u64 = 14;
/// A rejected video stays hidden for good; past this many the oldest rejections are dropped.
pub const MAX_SUPPRESSED_VIDEOS: usize = 5_000;
pub const MAX_SUPPRESSED_CHANNELS: usize = 100;

pub const REJECTION_MEMORY_MAX: usize = 200;
pub const REJECTION_PENALTY_1: f64 = 0.50;
pub const REJECTION_PENALTY_2: f64 = 0.20;
pub const REJECTION_PENALTY_3_PLUS: f64 = 0.05;
pub const FEED_HISTORY_MAX: usize = 3000;
pub const FEED_HISTORY_EXPIRY_DAYS: u64 = 14;
pub const TOPIC_EVIDENCE_MAX_ENTRIES: usize = 500;
pub const TOPIC_EVIDENCE_MAX_IDS: usize = 6;

// --- Data Structures ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ContentVector {
    pub topics: HashMap<String, f64>,
    pub topic_confidence: HashMap<String, f64>,
    pub anchor_topics: HashSet<String>,
    /// What kind of video it is ("tutorial", "review"); on a video's vector only.
    #[serde(default, skip_serializing_if = "HashSet::is_empty")]
    pub formats: HashSet<String>,
    pub duration: f64,
    pub pacing: f64,
    pub complexity: f64,
    pub is_live: f64,
}

impl Default for ContentVector {
    fn default() -> Self {
        Self {
            topics: HashMap::new(),
            topic_confidence: HashMap::new(),
            anchor_topics: HashSet::new(),
            formats: HashSet::new(),
            duration: 0.5,
            pacing: 0.5,
            complexity: 0.5,
            is_live: 0.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TimeBucket {
    WeekdayMorning,
    WeekdayAfternoon,
    WeekdayEvening,
    WeekdayNight,
    WeekendMorning,
    WeekendAfternoon,
    WeekendEvening,
    WeekendNight,
}

impl TimeBucket {
    pub fn current() -> Self {
        let now = Local::now();
        let is_weekend = matches!(now.weekday(), Weekday::Sat | Weekday::Sun);
        Self::from_parts(now.hour(), is_weekend)
    }

    pub fn from_parts(hour: u32, is_weekend: bool) -> Self {
        if is_weekend {
            match hour {
                6..=11 => TimeBucket::WeekendMorning,
                12..=17 => TimeBucket::WeekendAfternoon,
                18..=23 => TimeBucket::WeekendEvening,
                _ => TimeBucket::WeekendNight,
            }
        } else {
            match hour {
                6..=11 => TimeBucket::WeekdayMorning,
                12..=17 => TimeBucket::WeekdayAfternoon,
                18..=23 => TimeBucket::WeekdayEvening,
                _ => TimeBucket::WeekdayNight,
            }
        }
    }

    pub fn values() -> Vec<Self> {
        vec![
            TimeBucket::WeekdayMorning,
            TimeBucket::WeekdayAfternoon,
            TimeBucket::WeekdayEvening,
            TimeBucket::WeekdayNight,
            TimeBucket::WeekendMorning,
            TimeBucket::WeekendAfternoon,
            TimeBucket::WeekendEvening,
            TimeBucket::WeekendNight,
        ]
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct UserBrain {
    pub time_vectors: HashMap<TimeBucket, ContentVector>,
    /// Events each time-of-day vector has learned from; device-local.
    pub time_bucket_counts: HashMap<TimeBucket, i32>,
    pub global_vector: ContentVector,
    /// What the viewer took to lately ([`RECENT`]). Device-local.
    pub recent_vector: ContentVector,
    /// What the viewer takes to in Shorts, learned from Shorts at full strength.
    pub shorts_vector: ContentVector,
    /// How much the viewer takes to each format ([`formats`]); device-local.
    pub format_affinity: HashMap<String, f64>,
    /// Strong signals per YouTube category ([`categories`]); device-local.
    pub category_affinity: HashMap<String, f64>,
    pub channel_scores: HashMap<String, f64>,
    pub topic_affinities: HashMap<String, f64>,
    pub total_interactions: i32,
    pub consecutive_skips: i32,
    pub blocked_topics: HashSet<String>,
    pub blocked_channels: HashSet<String>,
    pub preferred_topics: HashSet<String>,
    pub has_completed_onboarding: bool,
    pub last_persona: Option<String>,
    pub persona_stability: i32,
    pub idf_word_frequency: HashMap<String, i32>,
    pub idf_total_documents: i32,
    pub watch_signal_progress: HashMap<String, f32>,
    pub watch_history_map: HashMap<String, f32>,
    pub channel_topic_profiles: HashMap<String, HashMap<String, f64>>,
    pub suppressed_video_ids: HashMap<String, u64>,
    pub suppressed_channels: HashMap<String, u64>,
    pub channel_strikes: HashMap<String, ChannelStrike>,
    pub rejection_patterns: HashMap<String, RejectionSignal>,
    pub feed_history: HashMap<String, FeedEntry>,
    pub recent_query_tokens: Vec<HashSet<String>>,
    /// When Home's discovery last served each interest cluster, by its representative.
    pub cluster_rotation: HashMap<String, u64>,
    /// Discovery queries whose recent results were mostly already shown, by token key.
    pub stale_queries: HashMap<String, u64>,
    /// Videos that opened a related lane lately, so the next loads open others.
    pub recent_related_seeds: HashMap<String, u64>,
    /// Shorts already on screen, by when; ranking holds them back for a week. Device-local.
    pub seen_shorts_history: HashMap<String, u64>,
    /// Home's interest chips as last chosen, so they stay put for a day. Device-local.
    pub interest_chips: crate::data_model::interest_chips::InterestChipSet,
    pub topic_evidence: HashMap<String, TopicEvidence>,
    pub schema_version: i32,
    /// The viewer's language: its stop words apply to every title ([`language`]).
    pub language_profile: Option<String>,
    /// The language keys are stemmed for. Set once, so a word keeps one key for the brain's life.
    pub key_language: Option<String>,
    /// The key spec the brain's keys are written in. Brains from before key spec 2 read 0, which
    /// converts them once on load.
    #[serde(default)]
    pub key_spec: u32,
    pub language_votes: HashMap<String, u32>,
    /// How titles write the keys that are spelled differently from the key.
    pub display_forms: DisplayForms,
    /// Videos already counted toward document frequency, so a rewatch never counts twice.
    pub counted_documents: CountedDocuments,
}

/// Videos counted toward document frequency, oldest first, bounded like Android's
/// `COUNTED_DOCUMENTS_MAX`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(transparent)]
pub struct CountedDocuments(VecDeque<String>);

impl CountedDocuments {
    pub const MAX: usize = 500;

    #[must_use]
    pub fn contains(&self, video_id: &str) -> bool {
        self.0.iter().any(|id| id == video_id)
    }

    /// Records `video_id`; false when it was already counted.
    pub fn insert(&mut self, video_id: &str) -> bool {
        if self.contains(video_id) {
            return false;
        }
        self.0.push_back(video_id.to_string());
        if self.0.len() > Self::MAX {
            self.0.pop_front();
        }
        true
    }
}

/// Events a time bucket needs before its vector weighs as much as the whole profile.
pub const TIME_BUCKET_CONFIDENT_EVENTS: i32 = 30;

/// How far a time of day's vector can be trusted, from 0 to 1.
impl UserBrain {
    /// The long-term topics strong enough to be interests. Weaker ones are traces of evidence
    /// still adding up: ranking reads them, but nothing searches for, groups or lists a topic from
    /// one half-watched video (Android `UserBrain.interests`).
    pub fn interests(&self) -> impl Iterator<Item = (&String, f64)> {
        self.global_vector
            .topics
            .iter()
            .filter(|(_, weight)| **weight >= TOPIC_PRUNE_THRESHOLD)
            .map(|(key, weight)| (key, *weight))
    }

    /// A fresh brain that still carries every block and "not interested" mark of this one.
    #[must_use]
    pub fn keeping_hidden_content(&self) -> Self {
        Self {
            blocked_channels: self.blocked_channels.clone(),
            blocked_topics: self.blocked_topics.clone(),
            suppressed_video_ids: self.suppressed_video_ids.clone(),
            suppressed_channels: self.suppressed_channels.clone(),
            ..Self::default()
        }
    }
}

impl Default for UserBrain {
    fn default() -> Self {
        let mut time_vectors = HashMap::new();
        for bucket in TimeBucket::values() {
            time_vectors.insert(bucket, ContentVector::default());
        }
        Self {
            time_vectors,
            time_bucket_counts: HashMap::new(),
            global_vector: ContentVector::default(),
            recent_vector: ContentVector::default(),
            shorts_vector: ContentVector::default(),
            format_affinity: HashMap::new(),
            category_affinity: HashMap::new(),
            channel_scores: HashMap::new(),
            topic_affinities: HashMap::new(),
            total_interactions: 0,
            consecutive_skips: 0,
            blocked_topics: HashSet::new(),
            blocked_channels: HashSet::new(),
            preferred_topics: HashSet::new(),
            has_completed_onboarding: false,
            last_persona: None,
            persona_stability: 0,
            idf_word_frequency: HashMap::new(),
            idf_total_documents: 0,
            watch_signal_progress: HashMap::new(),
            watch_history_map: HashMap::new(),
            channel_topic_profiles: HashMap::new(),
            suppressed_video_ids: HashMap::new(),
            suppressed_channels: HashMap::new(),
            channel_strikes: HashMap::new(),
            rejection_patterns: HashMap::new(),
            feed_history: HashMap::new(),
            recent_query_tokens: Vec::new(),
            cluster_rotation: HashMap::new(),
            stale_queries: HashMap::new(),
            recent_related_seeds: HashMap::new(),
            seen_shorts_history: HashMap::new(),
            interest_chips: crate::data_model::interest_chips::InterestChipSet::default(),
            topic_evidence: HashMap::new(),
            schema_version: SCHEMA_VERSION,
            language_profile: None,
            key_language: None,
            key_spec: keyspec::VERSION,
            language_votes: HashMap::new(),
            display_forms: DisplayForms::new(),
            counted_documents: CountedDocuments::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RejectionSignal {
    pub count: i32,
    pub last_rejected_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChannelStrike {
    pub count: i32,
    pub first_at: u64,
    pub last_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)] // tolerate brains written before `negative_signals` existed
pub struct TopicEvidence {
    pub positive_signals: i32,
    pub negative_signals: i32,
    pub watch_signals: i32,
    pub explicit_signals: i32,
    pub positive_score: f64,
    pub video_ids: HashSet<String>,
    pub channel_ids: HashSet<String>,
    pub first_seen_at: u64,
    pub last_seen_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FeedEntry {
    pub last_shown: u64,
    pub show_count: i32,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum FlowPersona {
    Initiate,
    Audiophile,
    Livewire,
    NightOwl,
    Binger,
    Scholar,
    DeepDiver,
    Skimmer,
    Specialist,
    Explorer,
}

impl FlowPersona {
    pub fn name(&self) -> &str {
        match self {
            Self::Initiate => "INITIATE",
            Self::Audiophile => "AUDIOPHILE",
            Self::Livewire => "LIVEWIRE",
            Self::NightOwl => "NIGHT_OWL",
            Self::Binger => "BINGER",
            Self::Scholar => "SCHOLAR",
            Self::DeepDiver => "DEEP_DIVER",
            Self::Skimmer => "SKIMMER",
            Self::Specialist => "SPECIALIST",
            Self::Explorer => "EXPLORER",
        }
    }

    pub fn title(&self) -> &str {
        match self {
            Self::Initiate => "The Initiate",
            Self::Audiophile => "The Audiophile",
            Self::Livewire => "The Livewire",
            Self::NightOwl => "The Night Owl",
            Self::Binger => "The Binger",
            Self::Scholar => "The Scholar",
            Self::DeepDiver => "The Deep Diver",
            Self::Skimmer => "The Skimmer",
            Self::Specialist => "The Specialist",
            Self::Explorer => "The Explorer",
        }
    }

    pub fn description(&self) -> &str {
        match self {
            Self::Initiate => "Just getting started. Your profile is still forming.",
            Self::Audiophile => "You use YouGlideTube mostly for Music. The vibe is everything.",
            Self::Livewire => "You love the raw energy of Livestreams and premieres.",
            Self::NightOwl => "You thrive in the dark. Most watching happens after midnight.",
            Self::Binger => "Once you start, you can't stop. Massive content waves.",
            Self::Scholar => "High-complexity content. Here to grow, not just be entertained.",
            Self::DeepDiver => "Long-form video essays and documentaries are your world.",
            Self::Skimmer => "Fast-paced, short content. Dopamine on demand.",
            Self::Specialist => "Laser-focused on a few niches. You know what you like.",
            Self::Explorer => "Chaotic and beautiful. A bit of everything.",
        }
    }

    pub fn icon(&self) -> &str {
        match self {
            Self::Initiate => "🌱",
            Self::Audiophile => "🎧",
            Self::Livewire => "🔴",
            Self::NightOwl => "🦉",
            Self::Binger => "🍿",
            Self::Scholar => "🎓",
            Self::DeepDiver => "🤿",
            Self::Skimmer => "⚡",
            Self::Specialist => "🎯",
            Self::Explorer => "🧭",
        }
    }

    pub fn from_name(name: &str) -> Self {
        match name {
            "AUDIOPHILE" => Self::Audiophile,
            "LIVEWIRE" => Self::Livewire,
            "NIGHT_OWL" => Self::NightOwl,
            "BINGER" => Self::Binger,
            "SCHOLAR" => Self::Scholar,
            "DEEP_DIVER" => Self::DeepDiver,
            "SKIMMER" => Self::Skimmer,
            "SPECIALIST" => Self::Specialist,
            "EXPLORER" => Self::Explorer,
            _ => Self::Initiate,
        }
    }
}

#[allow(dead_code)]
/// A key without its ":domain" tag ("metal:music" reads "metal").
pub fn strip_domain_tag(topic: &str) -> String {
    match topic.find(':') {
        Some(index) if index > 0 => topic[..index].to_string(),
        _ => topic.to_string(),
    }
}

// --- IDF Helpers ---

#[derive(Default)]
pub struct IdfSnapshot {
    pub word_frequencies: HashMap<String, i32>,
    pub total_documents: i32,
}

/// `base_weight` scaled by how rare `word` is among the viewer's own documents, from
/// [`IDF_MIN_WEIGHT`] for a word in every one to the full weight for an unseen one (Android
/// `NeuroTokenizer.calculateIdfWeight`). Below 30 documents nothing is rare yet.
// --- Cosine Similarity ---

// --- Vector Adjustment ---

// --- Smart Title Similarity ---

// --- Smart Diversity Reranking ---

pub struct ScoredVideo {
    pub id: String,
    pub title: String,
    pub channel_id: String,
    pub score: f64,
    pub vector: ContentVector,
}
