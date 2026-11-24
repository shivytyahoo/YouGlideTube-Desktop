//! Range-trimming for clip downloads: which samples of a track survive a clip,
//! and where the trimmed track starts presenting.
//!
//! The trim mirrors Android's `Mp4Remuxer`: video snaps the start back to the
//! keyframe at or before the clip start so the first kept frame decodes, audio
//! starts on its first sample at or after the clip start, and the copy stops at
//! the first sample (in decode order) presenting at or after the clip end — so
//! the kept samples are always one decode-order run, never a scattered subset
//! a decoder could not play. Timestamps are rebased by the clip start through
//! the edit list (`media_time`), so the file plays from zero. A frame that
//! presents just past the end can ride along when B-frame reordering puts it
//! before an in-range frame in decode order; the file then runs up to one frame
//! past the clip end, which the 5 s validation tolerance accepts.

use super::super::ClipRange;
use super::mp4_writer::WriterSample;
use super::{MatroskaPacket, PacketSource};

/// Which samples of a track survive a clip, and the edit-list start of the
/// trimmed track, in the track's own ticks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Trimmed {
    /// Indices of the kept samples, one decode-order run.
    pub indices: Vec<usize>,
    /// Where presentation starts in the trimmed track's ticks: the clip start,
    /// relative to the first kept sample's decode time. The writer writes it as
    /// an edit list when positive, and ignores it otherwise.
    pub media_time: i64,
}

/// Picks the samples of one track that survive a clip, from their decode and
/// presentation times in decode order.
///
/// `start`/`end` are the clip ends in track ticks, already shifted into the
/// track's media time (movie time plus the track's edit-list offset). Video
/// extends the start back to the previous keyframe; audio keeps only samples
/// presenting at or after the start.
pub(super) fn select_range(
    decode: &[i64],
    presentations: &[i64],
    is_sync: &[bool],
    is_video: bool,
    start: i64,
    end: i64,
) -> Result<Trimmed, String> {
    debug_assert_eq!(decode.len(), presentations.len());
    debug_assert_eq!(decode.len(), is_sync.len());
    let first = presentations
        .iter()
        .position(|presentation| *presentation >= start)
        .ok_or_else(|| "The clip starts after the end of this track".to_string())?;
    let mut keep_from = first;
    if is_video {
        while keep_from > 0 && !is_sync[keep_from] {
            keep_from -= 1;
        }
    }
    let mut keep_to = presentations.len();
    for index in keep_from + 1..presentations.len() {
        if presentations[index] >= end {
            keep_to = index;
            break;
        }
    }
    Ok(Trimmed {
        indices: (keep_from..keep_to).collect(),
        media_time: start - decode[keep_from],
    })
}

/// Trims a track's [`WriterSample`]s to a clip. `media_offset` is the track's
/// original edit-list start in ticks (0 when the stream starts at zero):
/// movie time is media time plus this offset.
pub(super) fn trim_samples(
    samples: &[WriterSample],
    timescale: u32,
    is_video: bool,
    media_offset: i64,
    clip: ClipRange,
) -> Result<Trimmed, String> {
    let to_ticks = |ms: u64| -> i64 {
        i64::try_from(ms as i128 * i128::from(timescale) / 1000).unwrap_or(i64::MAX)
    };
    let start = to_ticks(clip.start_ms).saturating_add(media_offset);
    let end = to_ticks(clip.end_ms).saturating_add(media_offset);
    let mut decode = Vec::with_capacity(samples.len());
    let mut presentations = Vec::with_capacity(samples.len());
    let mut clock = 0_i64;
    for sample in samples {
        decode.push(clock);
        presentations.push(clock + i64::from(sample.composition_offset));
        clock += i64::from(sample.duration);
    }
    let is_sync: Vec<bool> = samples.iter().map(|sample| sample.is_sync).collect();
    select_range(&decode, &presentations, &is_sync, is_video, start, end)
}

/// A packet stream that keeps only the clip range, for the Matroska path.
///
/// Video keeps the keyframe at or before the clip start (rebased to zero) so
/// the first in-range frame decodes; every packet is rebased by the clip start
/// and the stream ends at the first packet presenting at or after the clip end.
pub(super) struct ClipPackets {
    inner: PacketSource,
    start_ns: i128,
    end_ns: i128,
    is_video: bool,
    pending_keyframe: Option<MatroskaPacket>,
    emit_first: Option<MatroskaPacket>,
    started: bool,
    done: bool,
}

impl ClipPackets {
    pub(super) fn new(inner: PacketSource, is_video: bool, clip: ClipRange) -> Self {
        Self {
            inner,
            start_ns: i128::from(clip.start_ms) * 1_000_000,
            end_ns: i128::from(clip.end_ms) * 1_000_000,
            is_video,
            pending_keyframe: None,
            emit_first: None,
            started: false,
            done: false,
        }
    }

    fn rebase(&self, mut packet: MatroskaPacket) -> MatroskaPacket {
        packet.timestamp_ns = (packet.timestamp_ns - self.start_ns).max(0);
        packet
    }

    pub(super) fn next_packet(&mut self) -> Result<Option<MatroskaPacket>, String> {
        if let Some(packet) = self.emit_first.take() {
            return Ok(Some(packet));
        }
        if self.done {
            return Ok(None);
        }
        loop {
            let Some(packet) = self.inner.next_packet()? else {
                self.done = true;
                return Ok(None);
            };
            if packet.timestamp_ns >= self.end_ns {
                self.done = true;
                return Ok(None);
            }
            if packet.timestamp_ns < self.start_ns {
                if self.is_video && packet.keyframe {
                    self.pending_keyframe = Some(packet);
                }
                continue;
            }
            if !self.started {
                self.started = true;
                if let Some(keyframe) = self.pending_keyframe.take() {
                    // The keyframe presents before the clip start; it plays from
                    // zero, and the first in-range packet follows it.
                    self.emit_first = Some(self.rebase(packet));
                    return Ok(Some(self.rebase(keyframe)));
                }
            }
            return Ok(Some(self.rebase(packet)));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::ClipRange;
    use super::super::mp4_writer::WriterSample;
    use super::{select_range, trim_samples};

    fn sample(duration: u32, composition_offset: i32, is_sync: bool) -> WriterSample {
        WriterSample {
            size: 1,
            duration,
            composition_offset,
            is_sync,
        }
    }

    /// 30 fps video, a keyframe every 30 frames, at a 90 kHz timescale.
    fn video_samples(count: usize) -> Vec<WriterSample> {
        (0..count)
            .map(|index| sample(3000, 0, index % 30 == 0))
            .collect()
    }

    #[test]
    fn video_snaps_the_start_back_to_its_keyframe() {
        // 3 s of video; the clip [1.0 s, 2.0 s) starts mid-GOP (frame 30 is the
        // keyframe at 1.0 s, so frame 30 itself is the first kept sample).
        let samples = video_samples(90);
        let trimmed = trim_samples(
            &samples,
            90_000,
            true,
            0,
            ClipRange::new(1000, 2000).unwrap(),
        )
        .expect("trims");
        assert_eq!(trimmed.indices, (30..60).collect::<Vec<_>>());
        // The first kept frame decodes at 1.0 s and the clip starts there.
        assert_eq!(trimmed.media_time, 0);
    }

    #[test]
    fn video_keeps_the_keyframe_before_a_mid_gop_start() {
        // The clip starts at 1.1 s, inside the GOP that began at 1.0 s.
        let samples = video_samples(90);
        let trimmed = trim_samples(
            &samples,
            90_000,
            true,
            0,
            ClipRange::new(1100, 2000).unwrap(),
        )
        .expect("trims");
        assert_eq!(trimmed.indices, (30..60).collect::<Vec<_>>());
        // The keyframe decodes at 1.0 s; the edit list skips the first 100 ms.
        assert_eq!(trimmed.media_time, 9000);
    }

    #[test]
    fn audio_starts_on_its_first_sample_in_range() {
        // 1024-sample AAC frames at 44.1 kHz: a frame every ~23.2 ms.
        let samples: Vec<WriterSample> = (0..130).map(|_| sample(1024, 0, true)).collect();
        let trimmed = trim_samples(
            &samples,
            44_100,
            false,
            0,
            ClipRange::new(100, 500).unwrap(),
        )
        .expect("trims");
        // The first frame presenting at or after 100 ms is frame 5 (116 ms).
        assert_eq!(trimmed.indices[0], 5);
        assert_eq!(trimmed.indices.last(), Some(&21));
        assert_eq!(trimmed.media_time, 4410 - 5 * 1024);
    }

    #[test]
    fn b_frames_keep_a_decode_order_run() {
        // Decode order I0 P3 B1 B2, presenting at 0, 100, 33, 66 ms (30 fps).
        // The clip [50 ms, 110 ms) shows B2; decoding it needs I0 and P3.
        let decode = [0, 3000, 6000, 9000];
        let presentations = [0, 9000, 3000, 6000];
        let is_sync = [true, false, false, false];
        let trimmed =
            select_range(&decode, &presentations, &is_sync, true, 4500, 9900).expect("trims");
        assert_eq!(trimmed.indices, vec![0, 1, 2, 3]);
        assert_eq!(trimmed.media_time, 4500);
    }

    #[test]
    fn a_clip_past_the_track_end_is_an_error() {
        let samples = video_samples(90);
        let error = trim_samples(
            &samples,
            90_000,
            true,
            0,
            ClipRange::new(5000, 6000).unwrap(),
        )
        .expect_err("too late");
        assert!(error.contains("after the end"), "{error}");
    }

    #[test]
    fn the_media_offset_shifts_movie_time_into_media_time() {
        // A track whose first presentation is 2 s in (an edit list): the clip
        // [0 s, 1 s) of movie time is [2 s, 3 s) of media time.
        let samples = video_samples(180);
        let trimmed = trim_samples(
            &samples,
            90_000,
            true,
            180_000,
            ClipRange::new(0, 1000).unwrap(),
        )
        .expect("trims");
        assert_eq!(trimmed.indices, (60..90).collect::<Vec<_>>());
        assert_eq!(trimmed.media_time, 0);
    }

    #[test]
    fn frame_timestamps_select_the_same_range() {
        // WebM frames present in file order; the clip [1.0 s, 2.0 s) keeps the
        // keyframe at 1.0 s through the last frame before 2.0 s.
        let timestamps: Vec<i64> = (0..90).map(|index| index * 3_000).collect();
        let decode = timestamps.clone();
        let is_sync: Vec<bool> = (0..90).map(|index| index % 30 == 0).collect();
        let trimmed =
            select_range(&decode, &timestamps, &is_sync, true, 90_000, 180_000).expect("trims");
        assert_eq!(trimmed.indices, (30..60).collect::<Vec<_>>());
        assert_eq!(trimmed.media_time, 0);
    }
}
