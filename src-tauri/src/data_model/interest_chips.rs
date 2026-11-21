//! Home's interest chips, kept as a stored shape: the viewer's heaviest interest groups. The
//! chip-building engine that used to compute these is gone; the shape stays so an old stored
//! set still reads.

use serde::{Deserialize, Serialize};

pub const MAX_CHIPS: usize = 4;
pub const THEME_PREFIX: &str = "theme:";

/// The chips last chosen: each group's key and its mass then, in chip order.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct InterestChipSet {
    pub masses: Vec<(String, f64)>,
    pub computed_at: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterestChip {
    /// A cluster's representative, or `theme:<category>`.
    pub key: String,
    pub label: String,
    pub topics: Vec<String>,
    /// The theme category; the page names a theme chip after it.
    pub category: Option<String>,
    /// A theme's interests, each searched in turn.
    pub parts: Vec<InterestChip>,
}
