//! Linear-interpolation PCM resampler.
//!
//! A faithful port of Android's `AudioResampler` (part of the recognition
//! pipeline): the microphone is captured at the device rate and the samples
//! are resampled to the 16 kHz the fingerprint expects.

use super::signature::REQUIRED_SAMPLE_RATE;

/// Resamples mono 16-bit PCM from `input_sample_rate` to
/// [`REQUIRED_SAMPLE_RATE`]. A matching rate is returned unchanged.
pub fn resample(input: &[i16], input_sample_rate: u32) -> Vec<i16> {
    if input_sample_rate == REQUIRED_SAMPLE_RATE {
        return input.to_vec();
    }

    let ratio = REQUIRED_SAMPLE_RATE as f64 / input_sample_rate as f64;
    let output_length = (input.len() as f64 * ratio) as usize;
    let mut output = Vec::with_capacity(output_length);

    for i in 0..output_length {
        let src_pos = i as f64 / ratio;
        let src_index = src_pos as usize;
        let fraction = src_pos - src_index as f64;
        if src_index + 1 < input.len() {
            // `as i16` truncates toward zero, matching Kotlin's
            // Double.toInt().toShort().
            output.push(
                (input[src_index] as f64 * (1.0 - fraction)
                    + input[src_index + 1] as f64 * fraction) as i16,
            );
        } else {
            output.push(input[src_index]);
        }
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matching_rate_is_returned_unchanged() {
        let input = [0i16, 100, -200, 32767, -32768];
        assert_eq!(resample(&input, REQUIRED_SAMPLE_RATE), input);
    }

    #[test]
    fn downsample_length_matches_android() {
        // 1s at 44.1 kHz -> 16000 samples at 16 kHz.
        let input = vec![0i16; 44100];
        assert_eq!(resample(&input, 44100).len(), 16000);
        // 12s at 48 kHz -> 192000 samples.
        let input = vec![0i16; 48_000 * 12];
        assert_eq!(resample(&input, 48000).len(), 192_000);
    }

    #[test]
    fn constant_signal_stays_constant() {
        let input = vec![1234i16; 4410];
        assert!(resample(&input, 44100).iter().all(|&v| v == 1234));
    }

    #[test]
    fn linear_ramp_interpolates_midpoints() {
        // Halving the rate picks every second sample; a ramp's midpoint
        // between samples 0 and 2 is sample 1's value.
        let input: Vec<i16> = (0..100).map(|i| i * 100).collect();
        let out = resample(&input, 32000);
        assert_eq!(out.len(), 50);
        assert_eq!(out[1], 200);
        assert_eq!(out[25], 5000);
    }
}
