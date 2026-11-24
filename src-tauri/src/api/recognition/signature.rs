//! Shazam-compatible audio fingerprint (DejaVu signature) generator.
//!
//! A faithful port of Android's `ShazamSignatureGenerator` (itself ported
//! from the vibra/SongRec algorithm via Metrolist, GPL-3.0): 2048-point FFT
//! over 16 kHz mono PCM, peak spreading and recognition, then the binary
//! DejaVu envelope with a CRC32. The magic numbers below are wire format —
//! changing any of them makes Shazam reject the signature.

use base64::{Engine as _, engine::general_purpose::STANDARD};

/// Sample rate the fingerprint expects: mono 16-bit PCM at 16 kHz.
pub const REQUIRED_SAMPLE_RATE: u32 = 16_000;

const FFT_SIZE: usize = 2048;
const FFT_OUTPUT_SIZE: usize = FFT_SIZE / 2 + 1; // 1025
const MAX_PEAKS: usize = 255;
const MAX_TIME_SECONDS: f64 = 12.0;
const RING_BUF_SIZE: usize = 256;

const BAND_250_520: usize = 0;
const BAND_520_1450: usize = 1;
const BAND_1450_3500: usize = 2;
const BAND_3500_5500: usize = 3;

/// Generates a `data:audio/vnd.shazam.sig;base64,...` signature from mono
/// 16-bit little-endian PCM at 16 kHz. Rejects empty or odd-length input.
pub fn from_i16(samples: &[u8]) -> Result<String, String> {
    if samples.len() < 2 || samples.len() % 2 != 0 {
        return Err(
            "samples must be a non-empty byte array with even length (16-bit PCM)".to_string(),
        );
    }
    let mut pcm = vec![0i16; samples.len() / 2];
    for (i, chunk) in samples.chunks_exact(2).enumerate() {
        pcm[i] = i16::from_le_bytes([chunk[0], chunk[1]]);
    }
    Ok(SignatureGeneratorState::new().process(&pcm))
}

struct FrequencyPeak {
    fft_pass_number: usize,
    peak_magnitude: i32,
    corrected_peak_frequency_bin: i32,
}

struct SignatureGeneratorState {
    samples_ring: [i32; FFT_SIZE],
    samples_pos: usize,

    fft_outputs: Vec<[f64; FFT_OUTPUT_SIZE]>,
    fft_pos: usize,

    spread_ffts: Vec<[f64; FFT_OUTPUT_SIZE]>,
    spread_pos: usize,
    spread_num_written: usize,

    num_samples: usize,

    band_peaks: [Vec<FrequencyPeak>; 4],
    total_peaks: usize,

    hanning: [f64; FFT_SIZE],
}

impl SignatureGeneratorState {
    fn new() -> Self {
        // Hanning window matching the precomputed C++ HANNIG_MATRIX values.
        let mut hanning = [0.0; FFT_SIZE];
        for (i, value) in hanning.iter_mut().enumerate() {
            *value = 0.5 * (1.0 - ((2.0 * std::f64::consts::PI * (i + 1) as f64) / 2049.0).cos());
        }
        Self {
            samples_ring: [0; FFT_SIZE],
            samples_pos: 0,
            fft_outputs: vec![[0.0; FFT_OUTPUT_SIZE]; RING_BUF_SIZE],
            fft_pos: 0,
            spread_ffts: vec![[0.0; FFT_OUTPUT_SIZE]; RING_BUF_SIZE],
            spread_pos: 0,
            spread_num_written: 0,
            num_samples: 0,
            band_peaks: [Vec::new(), Vec::new(), Vec::new(), Vec::new()],
            total_peaks: 0,
            hanning,
        }
    }

    fn process(&mut self, pcm: &[i16]) -> String {
        let mut offset = 0;
        while offset + 128 <= pcm.len() {
            // Stop only once BOTH the time and peak budgets are exhausted
            // (matches the C++ implementation).
            let elapsed_sec = self.num_samples as f64 / REQUIRED_SAMPLE_RATE as f64;
            if elapsed_sec >= MAX_TIME_SECONDS && self.total_peaks >= MAX_PEAKS {
                break;
            }

            self.num_samples += 128;
            self.feed_samples(pcm, offset, 128);
            self.do_fft();
            self.do_peak_spreading();
            if self.spread_num_written >= 47 {
                self.do_peak_recognition();
            }
            offset += 128;
        }
        self.encode_signature()
    }

    fn feed_samples(&mut self, pcm: &[i16], start: usize, count: usize) {
        for k in start..start + count {
            self.samples_ring[self.samples_pos] = pcm[k] as i32;
            self.samples_pos = (self.samples_pos + 1) % FFT_SIZE;
        }
    }

    fn do_fft(&mut self) {
        let mut windowed = [0.0; FFT_SIZE];
        for (i, value) in windowed.iter_mut().enumerate() {
            *value = self.samples_ring[(self.samples_pos + i) % FFT_SIZE] as f64 * self.hanning[i];
        }
        self.fft_outputs[self.fft_pos] = compute_rfft(&windowed);
        self.fft_pos = (self.fft_pos + 1) % RING_BUF_SIZE;
    }

    fn do_peak_spreading(&mut self) {
        let last_fft_idx = (self.fft_pos as i32 - 1).rem_euclid(RING_BUF_SIZE as i32) as usize;
        let mut spread = self.fft_outputs[last_fft_idx];

        // Frequency spreading: 3-point running max (forward pass).
        for pos in 0..FFT_OUTPUT_SIZE - 2 {
            spread[pos] = spread[pos].max(spread[pos + 1]).max(spread[pos + 2]);
        }

        // Time spreading: propagate max into older entries at offsets -1, -3, -6.
        for pos in 0..FFT_OUTPUT_SIZE {
            let mut max_val = spread[pos];
            for offset in [-1, -3, -6] {
                let idx =
                    (self.spread_pos as i32 + offset).rem_euclid(RING_BUF_SIZE as i32) as usize;
                let old_val = self.spread_ffts[idx][pos];
                if old_val > max_val {
                    max_val = old_val;
                }
                self.spread_ffts[idx][pos] = max_val;
            }
            // The new entry keeps only frequency spreading, matching C++.
        }

        self.spread_ffts[self.spread_pos] = spread;
        self.spread_pos = (self.spread_pos + 1) % RING_BUF_SIZE;
        self.spread_num_written += 1;
    }

    fn do_peak_recognition(&mut self) {
        let fft_minus_46 = self.fft_outputs[(self.fft_pos as i32 - 46 + RING_BUF_SIZE as i32 * 2)
            .rem_euclid(RING_BUF_SIZE as i32) as usize];
        let spread_minus_49 =
            self.spread_ffts[(self.spread_pos as i32 - 49 + RING_BUF_SIZE as i32 * 2)
                .rem_euclid(RING_BUF_SIZE as i32) as usize];
        let other_offsets = [
            -53, -45, 165, 172, 179, 186, 193, 200, 214, 221, 228, 235, 242, 249,
        ];

        for bin_pos in 10..FFT_OUTPUT_SIZE - 8 {
            let fft_val = fft_minus_46[bin_pos];
            if fft_val < 1.0 / 64.0 || fft_val < spread_minus_49[bin_pos] {
                continue;
            }

            let mut max_neighbor_spread49 = 0.0;
            for neighbor_offset in [-10, -7, -4, -3, 1, 2, 5, 8] {
                let v = spread_minus_49[(bin_pos as i32 + neighbor_offset) as usize];
                if v > max_neighbor_spread49 {
                    max_neighbor_spread49 = v;
                }
            }
            if fft_val <= max_neighbor_spread49 {
                continue;
            }

            let mut max_neighbor_other = max_neighbor_spread49;
            for other_offset in other_offsets {
                let spread_idx = (self.spread_pos as i32 + other_offset)
                    .rem_euclid(RING_BUF_SIZE as i32) as usize;
                let v = self.spread_ffts[spread_idx][bin_pos - 1];
                if v > max_neighbor_other {
                    max_neighbor_other = v;
                }
            }
            if fft_val <= max_neighbor_other {
                continue;
            }

            let fft_number = self.spread_num_written - 46;
            let peak_mag = (1.0f64 / 64.0f64).max(fft_val).ln() * 1477.3 + 6144.0;
            let peak_mag_before =
                (1.0f64 / 64.0f64).max(fft_minus_46[bin_pos - 1]).ln() * 1477.3 + 6144.0;
            let peak_mag_after =
                (1.0f64 / 64.0f64).max(fft_minus_46[bin_pos + 1]).ln() * 1477.3 + 6144.0;

            let peak_variation1 = peak_mag * 2.0 - peak_mag_before - peak_mag_after;
            let peak_variation2 = (peak_mag_after - peak_mag_before) * 32.0 / peak_variation1;
            let corrected_bin = bin_pos as f64 * 64.0 + peak_variation2;
            let frequency_hz = corrected_bin * (16000.0 / 2.0 / 1024.0 / 64.0);

            let band = if frequency_hz < 250.0 {
                continue;
            } else if frequency_hz < 520.0 {
                BAND_250_520
            } else if frequency_hz < 1450.0 {
                BAND_520_1450
            } else if frequency_hz < 3500.0 {
                BAND_1450_3500
            } else if frequency_hz <= 5500.0 {
                BAND_3500_5500
            } else {
                continue;
            };

            // `as i32` truncates toward zero and saturates, matching Kotlin's
            // Double.toInt() (NaN -> 0, out of range -> clamp).
            self.band_peaks[band].push(FrequencyPeak {
                fft_pass_number: fft_number,
                peak_magnitude: peak_mag as i32,
                corrected_peak_frequency_bin: corrected_bin as i32,
            });
            self.total_peaks += 1;
        }
    }

    fn encode_signature(&self) -> String {
        let mut contents: Vec<u8> = Vec::new();

        for band_id in 0..4 {
            let peaks = &self.band_peaks[band_id];
            if peaks.is_empty() {
                continue;
            }

            let mut peak_buf: Vec<u8> = Vec::new();
            let mut prev_fft_pass_number: usize = 0;
            for peak in peaks {
                let diff = peak.fft_pass_number - prev_fft_pass_number;
                if diff >= 255 {
                    peak_buf.push(0xFF);
                    write_le32(&mut peak_buf, peak.fft_pass_number as u32);
                    prev_fft_pass_number = peak.fft_pass_number;
                }
                peak_buf.push((peak.fft_pass_number - prev_fft_pass_number) as u8);
                write_le16(&mut peak_buf, peak.peak_magnitude as u16);
                write_le16(&mut peak_buf, peak.corrected_peak_frequency_bin as u16);
                prev_fft_pass_number = peak.fft_pass_number;
            }

            write_le32(&mut contents, 0x60030040 + band_id as u32);
            write_le32(&mut contents, peak_buf.len() as u32);
            contents.extend_from_slice(&peak_buf);

            let pad_bytes = (4 - peak_buf.len() % 4) % 4;
            contents.extend(std::iter::repeat_n(0u8, pad_bytes));
        }

        let size_minus_header = contents.len() + 8;
        let samples_and_offset =
            (self.num_samples + REQUIRED_SAMPLE_RATE as usize * 24 / 100) as u32;

        let mut header = Vec::with_capacity(48);
        write_le32(&mut header, 0xcafe2580);
        write_le32(&mut header, 0); // crc32 placeholder
        write_le32(&mut header, size_minus_header as u32);
        write_le32(&mut header, 0x94119c00);
        write_le32(&mut header, 0);
        write_le32(&mut header, 0);
        write_le32(&mut header, 0);
        write_le32(&mut header, 3 << 27); // shifted_sample_rate_id
        write_le32(&mut header, 0);
        write_le32(&mut header, 0);
        write_le32(&mut header, samples_and_offset);
        write_le32(&mut header, (15 << 19) + 0x40000);

        let mut full_buf: Vec<u8> = Vec::with_capacity(56 + contents.len());
        full_buf.extend_from_slice(&header);
        write_le32(&mut full_buf, 0x40000000);
        write_le32(&mut full_buf, contents.len() as u32 + 8);
        full_buf.extend_from_slice(&contents);

        let crc = crc32_ieee(&full_buf[8..]);
        full_buf[4..8].copy_from_slice(&crc.to_le_bytes());

        format!(
            "data:audio/vnd.shazam.sig;base64,{}",
            STANDARD.encode(&full_buf)
        )
    }
}

fn write_le32(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn write_le16(out: &mut Vec<u8>, value: u16) {
    out.extend_from_slice(&value.to_le_bytes());
}

/// IEEE CRC32 (polynomial 0xEDB88320), as `java.util.zip.CRC32` computes it.
/// No crc crate in the tree, so the table is built once at compile time.
const fn make_crc_table() -> [u32; 256] {
    let mut table = [0u32; 256];
    let mut i = 0;
    while i < 256 {
        let mut c = i as u32;
        let mut k = 0;
        while k < 8 {
            c = if c & 1 != 0 {
                0xEDB88320 ^ (c >> 1)
            } else {
                c >> 1
            };
            k += 1;
        }
        table[i] = c;
        i += 1;
    }
    table
}

static CRC_TABLE: [u32; 256] = make_crc_table();

fn crc32_ieee(data: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &byte in data {
        crc = CRC_TABLE[((crc ^ byte as u32) & 0xFF) as usize] ^ (crc >> 8);
    }
    crc ^ 0xFFFF_FFFF
}

/// Iterative radix-2 Cooley-Tukey FFT; returns 1025 magnitudes
/// (FFTW3 r2c-compatible).
fn compute_rfft(windowed: &[f64; FFT_SIZE]) -> [f64; FFT_OUTPUT_SIZE] {
    let n = windowed.len();
    let mut re = *windowed;
    let mut im = [0.0; FFT_SIZE];

    // Bit-reversal permutation.
    let mut j = 0usize;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }

    let mut len = 2;
    while len <= n {
        let half_len = len >> 1;
        let ang = -std::f64::consts::PI / half_len as f64;
        let w_base_re = ang.cos();
        let w_base_im = ang.sin();
        let mut i = 0;
        while i < n {
            let mut w_re = 1.0;
            let mut w_im = 0.0;
            for k in 0..half_len {
                let u = i + k;
                let v = u + half_len;
                let even_re = re[u];
                let even_im = im[u];
                let odd_re = re[v] * w_re - im[v] * w_im;
                let odd_im = re[v] * w_im + im[v] * w_re;
                re[u] = even_re + odd_re;
                im[u] = even_im + odd_im;
                re[v] = even_re - odd_re;
                im[v] = even_im - odd_im;
                let new_w_re = w_re * w_base_re - w_im * w_base_im;
                w_im = w_re * w_base_im + w_im * w_base_re;
                w_re = new_w_re;
            }
            i += len;
        }
        len <<= 1;
    }

    let scale_factor = 1.0 / (1 << 17) as f64;
    let min_val = 1e-10;
    let mut out = [0.0; FFT_OUTPUT_SIZE];
    for (idx, value) in out.iter_mut().enumerate() {
        let r = re[idx];
        let img = im[idx];
        let mag = (r * r + img * img) * scale_factor;
        *value = if mag < min_val { min_val } else { mag };
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Decodes a signature back to its raw bytes for structural assertions.
    fn decode_signature(signature: &str) -> Vec<u8> {
        let b64 = signature
            .strip_prefix("data:audio/vnd.shazam.sig;base64,")
            .expect("signature must carry the Shazam data URI prefix");
        STANDARD
            .decode(b64)
            .expect("signature must be valid base64")
    }

    fn sine_pcm(freq_hz: f64, seconds: f64) -> Vec<u8> {
        let samples = (seconds * REQUIRED_SAMPLE_RATE as f64) as usize;
        let mut bytes = Vec::with_capacity(samples * 2);
        for n in 0..samples {
            let value = ((n as f64 * 2.0 * std::f64::consts::PI * freq_hz
                / REQUIRED_SAMPLE_RATE as f64)
                .sin()
                * 12000.0) as i16;
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        bytes
    }

    /// Deterministic white noise (LCG): broadband energy, so peaks arrive
    /// fast — the signal that exercises the 12s/255-peak stop condition.
    fn noise_pcm(seconds: f64) -> Vec<u8> {
        let samples = (seconds * REQUIRED_SAMPLE_RATE as f64) as usize;
        let mut bytes = Vec::with_capacity(samples * 2);
        let mut state: u32 = 0x12345678;
        for _ in 0..samples {
            state = state.wrapping_mul(1664525).wrapping_add(1013904223);
            let value = ((state >> 16) as u16 as i32 - 32768) / 2;
            bytes.extend_from_slice(&(value as i16).to_le_bytes());
        }
        bytes
    }

    /// A tone sweeping 300 Hz -> 3000 Hz: realistic, non-stationary audio.
    /// A perfectly steady tone yields no peaks in this algorithm (its
    /// magnitude never exceeds the running spread maximum), so tests that
    /// need peaks use the chirp; see `stationary_sine_yields_no_peaks`.
    fn chirp_pcm(seconds: f64) -> Vec<u8> {
        let samples = (seconds * REQUIRED_SAMPLE_RATE as f64) as usize;
        let mut bytes = Vec::with_capacity(samples * 2);
        let mut phase = 0.0;
        for n in 0..samples {
            let t = n as f64 / REQUIRED_SAMPLE_RATE as f64;
            let freq = 300.0 + (3000.0 - 300.0) * t / seconds;
            phase += 2.0 * std::f64::consts::PI * freq / REQUIRED_SAMPLE_RATE as f64;
            let value = (phase.sin() * 12000.0) as i16;
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        bytes
    }

    #[test]
    fn rejects_empty_and_odd_length_input() {
        assert!(from_i16(&[]).is_err());
        assert!(from_i16(&[0]).is_err());
        assert!(from_i16(&[0, 0, 0]).is_err());
    }

    #[test]
    fn signature_envelope_is_valid() {
        let pcm = chirp_pcm(12.0);
        let signature = from_i16(&pcm).expect("chirp input must sign");
        let bytes = decode_signature(&signature);
        assert!(bytes.len() > 56);
        assert_eq!(
            u32::from_le_bytes(bytes[0..4].try_into().unwrap()),
            0xcafe2580
        );
        // CRC32 stored at bytes 4..8 covers everything from byte 8 on.
        let stored = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
        assert_eq!(stored, crc32_ieee(&bytes[8..]));
        assert_eq!(
            u32::from_le_bytes(bytes[8..12].try_into().unwrap()),
            (bytes.len() - 56 + 8) as u32
        );
        assert_eq!(
            u32::from_le_bytes(bytes[12..16].try_into().unwrap()),
            0x94119c00
        );
        // 12s of audio: 192000 samples + 16000 * 0.24 offset.
        let samples_and_offset = u32::from_le_bytes(bytes[40..44].try_into().unwrap());
        assert_eq!(samples_and_offset, 192000 + 3840);
    }

    #[test]
    fn signature_is_deterministic() {
        let pcm = sine_pcm(880.0, 12.0);
        assert_eq!(from_i16(&pcm), from_i16(&pcm));
    }

    #[test]
    fn silence_produces_a_valid_envelope_with_no_peaks() {
        let pcm = vec![0u8; 16000 * 2 * 12];
        let signature = from_i16(&pcm).expect("silence must sign");
        let bytes = decode_signature(&signature);
        // Header (48) + tag block (8) + no band sections.
        assert_eq!(bytes.len(), 56);
        let stored = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
        assert_eq!(stored, crc32_ieee(&bytes[8..]));
    }

    #[test]
    fn stationary_sine_yields_no_peaks() {
        // A perfectly steady tone never exceeds its own running spread
        // maximum (measured: spread sits ~1e-7 above the frame magnitude),
        // so the peak test rejects every bin. That is the algorithm's
        // behaviour, not a port bug — real music is never stationary, and
        // the envelope stays valid with zero band sections.
        let pcm = sine_pcm(440.0, 12.0);
        let signature = from_i16(&pcm).expect("sine input must sign");
        let bytes = decode_signature(&signature);
        assert_eq!(bytes.len(), 56);
        let stored = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
        assert_eq!(stored, crc32_ieee(&bytes[8..]));
    }

    #[test]
    fn chirp_lands_peaks_in_the_bands_it_crosses() {
        // The sweep starts at 300 Hz (band 0: 250-520 Hz) and ends at
        // 3000 Hz (band 2: 1450-3500 Hz); both must carry sections.
        let pcm = chirp_pcm(12.0);
        let bytes = decode_signature(&from_i16(&pcm).unwrap());
        let mut offset = 56;
        let mut seen = [false; 4];
        while offset + 8 <= bytes.len() {
            let tag = u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap());
            let size =
                u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
            for band in 0..4 {
                if tag == 0x60030040 + band as u32 {
                    seen[band] = true;
                    assert!(size > 0, "band {band} must hold peaks for the chirp");
                }
            }
            offset += 8 + size + (4 - size % 4) % 4;
        }
        assert!(seen[0], "chirp must produce band-0 peaks");
        assert!(seen[2], "chirp must produce band-2 peaks");
    }

    #[test]
    fn twelve_second_cap_stops_processing_long_input() {
        // 30s of white noise: peaks hit the 255 budget long before 12s, so
        // the generator stops at the first check past 12s — 192000 samples.
        let pcm = noise_pcm(30.0);
        let bytes = decode_signature(&from_i16(&pcm).unwrap());
        let samples_and_offset = u32::from_le_bytes(bytes[40..44].try_into().unwrap());
        assert_eq!(samples_and_offset, 192000 + 3840);
    }

    #[test]
    fn crc32_matches_the_standard_check_value() {
        // "123456789" -> 0xCBF43926 is the canonical IEEE CRC32 check value.
        assert_eq!(crc32_ieee(b"123456789"), 0xCBF43926);
    }

    #[test]
    fn rfft_of_a_pure_tone_peaks_at_its_bin() {
        // 440 Hz at 16 kHz with a 2048-point FFT lands on bin ~56.
        let mut windowed = [0.0; FFT_SIZE];
        for (n, value) in windowed.iter_mut().enumerate() {
            *value = (n as f64 * 2.0 * std::f64::consts::PI * 440.0 / 16000.0).sin();
        }
        let out = compute_rfft(&windowed);
        let (peak_bin, _) = out
            .iter()
            .enumerate()
            .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap())
            .unwrap();
        assert!((53..=59).contains(&peak_bin), "peak bin {peak_bin}");
    }
}
