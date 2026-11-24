//! Tauri command for Shazam-style music recognition.
//!
//! The frontend captures 12s of microphone audio through Web Audio and
//! sends base64 mono 16-bit PCM at the device sample rate; this command
//! resamples to 16 kHz, fingerprints it and asks Shazam — the same pipeline
//! Android's `MusicRecognitionRepository` runs.

use base64::{Engine as _, engine::general_purpose::STANDARD};

use crate::api::http::shared_client;
use crate::api::recognition::{
    REQUIRED_SAMPLE_RATE, RecognitionResult, recognize, resample, signature,
};
use crate::errors::{AppError, ErrorResponse};

type CmdResult<T> = Result<T, ErrorResponse>;

/// Maximum PCM payload accepted: 20s at 192 kHz mono 16-bit. The frontend
/// sends 12s, so anything larger is a bad caller, not a real capture.
const MAX_PCM_BYTES: usize = 20 * 192_000 * 2;

#[tauri::command]
pub async fn recognize_song(pcm_base64: String, sample_rate: u32) -> CmdResult<RecognitionResult> {
    recognize_song_inner(pcm_base64, sample_rate)
        .await
        .map_err(ErrorResponse::from)
}

async fn recognize_song_inner(
    pcm_base64: String,
    sample_rate: u32,
) -> Result<RecognitionResult, AppError> {
    if !(8_000..=192_000).contains(&sample_rate) {
        return Err(AppError::Validation(format!(
            "sample_rate {sample_rate} is outside 8000..=192000"
        )));
    }
    let pcm_bytes = STANDARD
        .decode(pcm_base64.as_str())
        .map_err(|_| AppError::Validation("pcm_base64 is not valid base64".to_string()))?;
    if pcm_bytes.is_empty() || pcm_bytes.len() % 2 != 0 || pcm_bytes.len() > MAX_PCM_BYTES {
        return Err(AppError::Validation(
            "pcm must be non-empty, even-length 16-bit PCM".to_string(),
        ));
    }

    // Fingerprinting is CPU-bound (1500 FFTs for 12s); keep it off the
    // async runtime threads.
    let (signature, sample_duration_ms) = tokio::task::spawn_blocking(move || {
        let mut pcm = vec![0i16; pcm_bytes.len() / 2];
        for (i, chunk) in pcm_bytes.chunks_exact(2).enumerate() {
            pcm[i] = i16::from_le_bytes([chunk[0], chunk[1]]);
        }
        let resampled = resample::resample(&pcm, sample_rate);
        let sample_duration_ms = (resampled.len() as u64 * 1000) / REQUIRED_SAMPLE_RATE as u64;
        let mut bytes = Vec::with_capacity(resampled.len() * 2);
        for sample in &resampled {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        let signature =
            signature::from_i16(&bytes).map_err(|message| AppError::Validation(message))?;
        Ok::<(String, u64), AppError>((signature, sample_duration_ms))
    })
    .await
    .map_err(|error| AppError::Internal(format!("recognition task failed: {error}")))??;

    recognize(shared_client(), &signature, sample_duration_ms).await
}
