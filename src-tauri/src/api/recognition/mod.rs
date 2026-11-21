//! Shazam-style music recognition: mic audio in, identified song out.
//!
//! The pipeline mirrors Android's `MusicRecognitionRepository`:
//! capture (frontend, Web Audio) -> resample to 16 kHz -> DejaVu
//! fingerprint -> Shazam discovery endpoint. The endpoint needs no API key.

pub mod resample;
pub mod shazam;
pub mod signature;

pub use shazam::{RecognitionResult, recognize};
pub use signature::REQUIRED_SAMPLE_RATE;
