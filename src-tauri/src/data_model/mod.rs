//! The local data model: the canonical record shapes, the merge/apply logic and the
//! backup export/import helpers. This used to live in the sync engine's module; the
//! P2P sync transport is gone, but the backup files still round-trip through these
//! shapes, so they stay.

pub mod apply;
pub mod brain;
pub mod caps;
pub mod feature_tables;
pub mod keyed_lists;
pub mod topic_catalog;
pub mod display_forms;
pub mod interest_chips;
pub mod key_migration;
pub mod keyspec;
pub mod language;
pub mod signals;
pub mod brain_attrib;
pub mod brain_rekey;
pub mod brainmap;
pub mod canonical;
pub mod changes;
pub mod clock;
pub mod collection;
pub mod compat;
pub mod error;
pub mod export;
pub mod identity;
pub mod ledger;
pub mod mapping;
pub mod merge;
pub mod notes;
pub mod saved_shorts;
pub mod settings_map;
pub mod tombstones;
pub mod music_brain;
