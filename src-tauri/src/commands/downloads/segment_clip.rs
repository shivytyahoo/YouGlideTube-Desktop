//! Segment-only clip downloads: fetch only the DASH segments covering a clip,
//! instead of the whole stream — a port of Android's `SegmentClipFetcher`.
//!
//! For each stream the init segment and the index are fetched first
//! (kilobytes, via HTTP Range requests); the index maps every segment to its
//! time range and its byte range in the source file, so only the segments
//! overlapping the clip are fetched, in parallel, and written contiguously
//! after the init segment. The part files then read as one fragmented file,
//! and the runner's remux trims the exact end. The index is the MP4 `sidx`
//! for MP4 streams and the WebM `Cues` element for WebM streams.
//!
//! A stream without an index, a bad index, or a segment that does not start
//! with a media box falls back to the full download: the attempt reports
//! `NotSegmented` and the caller runs its normal path. A refused URL still
//! reports `Denied`, so the caller's re-resolve logic applies unchanged.

use std::path::Path;
use std::sync::atomic::Ordering;

use super::ClipRange;
use super::progress::ProgressEmitter;
use super::transfer::{
    RangeFetch, SegmentMagic, TrackFetch, fetch_range_bytes, fetch_range_into_file,
};

/// One media segment: its time range and its inclusive byte range in the
/// source file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Segment {
    pub start_us: u64,
    pub end_us: u64,
    pub byte_start: u64,
    pub byte_end: u64,
}

/// One track of a clip download: where its bytes go and the index that maps
/// its segments.
pub struct ClipTrack<'a> {
    pub fetch: &'a TrackFetch<'a>,
    /// Whether the stream is WebM (Cues index) rather than MP4 (`sidx`).
    pub is_webm: bool,
    pub init_range: (u64, u64),
    pub index_range: (u64, u64),
    pub content_length: Option<u64>,
}

/// What a segment-clip attempt reports back to the job.
pub enum ClipAttempt {
    /// The segments are in the part files; the planned byte total, for the
    /// progress bar.
    Fetched { total_bytes: u64 },
    /// Some stream has no usable segment index: the caller falls back to the
    /// full download.
    NotSegmented,
    /// A link was refused: the caller refreshes the links and may retry the
    /// attempt.
    Denied,
}

enum PlanOutcome<'a> {
    Planned(StreamPlan<'a>),
    NotSegmented,
    Denied,
}

struct StreamPlan<'a> {
    fetch: &'a TrackFetch<'a>,
    is_webm: bool,
    init_bytes: Vec<u8>,
    segments: Vec<Segment>,
    /// Destination offset of each segment in the part file (init first).
    dest_offsets: Vec<u64>,
    total_bytes: u64,
}

/// Fetches only the segments covering `clip` for the video track (when there
/// is one) and every audio track, into their part files. The video rides along
/// with the audio plans: all tracks are planned first, so a stream with no
/// usable index fails the attempt before any bytes are written for the others.
///
/// Bytes are counted into the job's progress as they land. On any outcome
/// other than `Fetched`, the part files are removed and the counted bytes are
/// taken back out, so the caller's full download starts from clean parts and
/// a zero counter — a segment file is init + selected segments, never a
/// prefix of the full stream, so the full download must not resume from it.
pub async fn fetch_clip_segments<'a>(
    video: Option<ClipTrack<'a>>,
    audios: &[ClipTrack<'a>],
    clip: ClipRange,
) -> Result<ClipAttempt, String> {
    let clip_start_us = clip.start_ms.saturating_mul(1000);
    let clip_end_us = clip.end_ms.saturating_mul(1000);
    // Fresh part files, including a previous full attempt's worker fragments:
    // a segment file is init + selected segments, so no saved bytes from a
    // full attempt fit it.
    for track in video.iter().chain(audios.iter()) {
        clear_parts(track.fetch.path).await;
    }

    let mut plans = Vec::new();
    if let Some(video) = &video {
        match plan_stream(video, clip_start_us, clip_end_us).await? {
            PlanOutcome::Planned(plan) => plans.push(plan),
            PlanOutcome::NotSegmented => return Ok(ClipAttempt::NotSegmented),
            PlanOutcome::Denied => return Ok(ClipAttempt::Denied),
        }
    }
    for audio in audios {
        match plan_stream(audio, clip_start_us, clip_end_us).await? {
            PlanOutcome::Planned(plan) => plans.push(plan),
            PlanOutcome::NotSegmented => return Ok(ClipAttempt::NotSegmented),
            PlanOutcome::Denied => return Ok(ClipAttempt::Denied),
        }
    }

    let total_bytes: u64 = plans.iter().map(|plan| plan.total_bytes).sum();
    // Every track shares the job's emitter; the audio plan always exists.
    let emitter = plans[0].fetch.emitter;
    emitter.set_total(Some(total_bytes));
    let mut counted: u64 = 0;
    for plan in &plans {
        tokio::fs::write(plan.fetch.path, &plan.init_bytes)
            .await
            .map_err(|error| {
                format!(
                    "Could not write the clip header for {}: {error}",
                    plan.fetch.label
                )
            })?;
        let init_len = plan.init_bytes.len() as u64;
        counted += init_len;
        emitter.downloaded.fetch_add(init_len, Ordering::Relaxed);
    }
    for plan in &plans {
        let (outcome, plan_counted) = fetch_segments(plan).await?;
        counted += plan_counted;
        match outcome {
            SegmentOutcome::Done => {}
            SegmentOutcome::Denied | SegmentOutcome::NotSegmented => {
                return Ok(discard_attempt(&plans, emitter, counted, outcome).await);
            }
        }
    }
    Ok(ClipAttempt::Fetched { total_bytes })
}

/// Removes the attempt's part files and takes its counted bytes back out of
/// the job's progress, then reports the fallback outcome.
async fn discard_attempt<'a>(
    plans: &'a [StreamPlan<'a>],
    emitter: &'a ProgressEmitter,
    counted: u64,
    outcome: SegmentOutcome,
) -> ClipAttempt {
    for plan in plans {
        clear_parts(plan.fetch.path).await;
    }
    emitter.downloaded.fetch_sub(
        counted.min(emitter.downloaded.load(Ordering::Relaxed)),
        Ordering::Relaxed,
    );
    match outcome {
        SegmentOutcome::Denied => ClipAttempt::Denied,
        SegmentOutcome::NotSegmented => ClipAttempt::NotSegmented,
        SegmentOutcome::Done => ClipAttempt::NotSegmented,
    }
}

/// The base part file and every parallel worker's fragment for it.
async fn clear_parts(path: &Path) {
    let _ = tokio::fs::remove_file(path).await;
    for worker in 0..8 {
        let _ = tokio::fs::remove_file(super::transfer::part_path(path, worker)).await;
    }
}

enum SegmentOutcome {
    Done,
    Denied,
    NotSegmented,
}

async fn plan_stream<'a>(
    track: &'a ClipTrack<'a>,
    clip_start_us: u64,
    clip_end_us: u64,
) -> Result<PlanOutcome<'a>, String> {
    let init_bytes =
        match fetch_range_bytes(track.fetch, track.init_range.0, track.init_range.1).await? {
            RangeFetch::Fetched(bytes) => bytes,
            RangeFetch::Denied => return Ok(PlanOutcome::Denied),
            RangeFetch::BadSegment => return Ok(PlanOutcome::NotSegmented),
        };
    let index_bytes =
        match fetch_range_bytes(track.fetch, track.index_range.0, track.index_range.1).await? {
            RangeFetch::Fetched(bytes) => bytes,
            RangeFetch::Denied => return Ok(PlanOutcome::Denied),
            RangeFetch::BadSegment => return Ok(PlanOutcome::NotSegmented),
        };
    let segments = if track.is_webm {
        parse_webm_cues(&init_bytes, &index_bytes, track.content_length)
    } else {
        parse_sidx(&index_bytes, track.index_range.0)
    };
    let Some(segments) = segments else {
        return Ok(PlanOutcome::NotSegmented);
    };
    let selected: Vec<Segment> = segments
        .into_iter()
        .filter(|segment| segment.start_us < clip_end_us && segment.end_us > clip_start_us)
        .collect();
    if selected.is_empty() {
        return Ok(PlanOutcome::NotSegmented);
    }
    let mut dest_offsets = Vec::with_capacity(selected.len());
    let mut offset = init_bytes.len() as u64;
    for segment in &selected {
        dest_offsets.push(offset);
        offset += segment.byte_end - segment.byte_start + 1;
    }
    let total_bytes = offset;
    Ok(PlanOutcome::Planned(StreamPlan {
        fetch: track.fetch,
        is_webm: track.is_webm,
        init_bytes,
        segments: selected,
        dest_offsets,
        total_bytes,
    }))
}

/// Fetches one plan's segments into its part file, counting the landed bytes
/// into the job's progress. Segments go in bounded parallel batches (the
/// job's thread count, like the full download), so a long clip does not open
/// hundreds of requests at once. Returns the outcome and the bytes counted,
/// so the caller can take them back out when the attempt falls back.
async fn fetch_segments<'a>(plan: &'a StreamPlan<'a>) -> Result<(SegmentOutcome, u64), String> {
    let magic = if plan.is_webm {
        SegmentMagic::Webm
    } else {
        SegmentMagic::Mp4
    };
    let concurrency = plan.fetch.threads.max(1) as usize;
    let mut counted: u64 = 0;
    for (chunk_no, chunk) in plan.segments.chunks(concurrency).enumerate() {
        let base = chunk_no * concurrency;
        let futures: Vec<_> = chunk
            .iter()
            .enumerate()
            .map(|(offset, segment)| {
                fetch_range_into_file(
                    plan.fetch,
                    plan.fetch.path,
                    plan.dest_offsets[base + offset],
                    segment.byte_start,
                    segment.byte_end,
                    Some(magic),
                )
            })
            .collect();
        let results = futures_util::future::join_all(futures).await;
        for result in results {
            match result? {
                RangeFetch::Fetched(written) => {
                    counted += written;
                    plan.fetch
                        .emitter
                        .downloaded
                        .fetch_add(written, Ordering::Relaxed);
                    plan.fetch.emitter.emit_downloading();
                }
                RangeFetch::Denied => return Ok((SegmentOutcome::Denied, counted)),
                RangeFetch::BadSegment => return Ok((SegmentOutcome::NotSegmented, counted)),
            }
        }
    }
    Ok((SegmentOutcome::Done, counted))
}

/// Parses the `sidx` box inside `index_bytes` (the stream's indexRange).
/// `sidx_file_offset` is the file offset the index bytes were fetched from,
/// so the segment byte ranges come out absolute. `None` when the bytes hold
/// no usable sidx: the caller downloads the whole stream instead, so a bad
/// index never fails a download.
///
/// A `sidx` lists its subsegments in order: each reference carries the
/// subsegment's byte size and its duration in the box's timescale, and the
/// first subsegment starts `first_offset` bytes after the END of the `sidx`
/// box itself (ISO 14496-12 §8.16.3). A stream whose index holds a nested
/// `sidx` (reference_type 1) or an unknown version has no usable list here.
pub fn parse_sidx(index_bytes: &[u8], sidx_file_offset: u64) -> Option<Vec<Segment>> {
    let sidx = top_level_boxes(index_bytes)?
        .into_iter()
        .find(|span| span.kind == *b"sidx")?;
    let payload = &index_bytes[sidx.payload_start..sidx.end];
    if payload.len() < 4 {
        return None;
    }
    let version = payload[0];
    if version != 0 && version != 1 {
        return None;
    }
    let header_size = if version == 0 { 24 } else { 32 };
    if payload.len() < header_size {
        return None;
    }
    let mut pos = 4; // version + flags
    pos += 4; // reference_ID
    let timescale = be32(payload, pos)? as u64;
    pos += 4;
    if timescale == 0 {
        return None;
    }
    let (earliest, first_offset) = if version == 0 {
        let earliest = be32(payload, pos)? as u64;
        let first_offset = be32(payload, pos + 4)? as u64;
        pos += 8;
        (earliest, first_offset)
    } else {
        let earliest = be64(payload, pos)?;
        let first_offset = be64(payload, pos + 8)?;
        pos += 16;
        (earliest, first_offset)
    };
    pos += 2; // reserved
    let reference_count = be16(payload, pos)? as usize;
    pos += 2;
    if reference_count == 0 || payload.len() < pos + reference_count * 12 {
        return None;
    }
    let mut time_us = ticks_to_us(earliest, timescale);
    let mut byte_cursor = sidx_file_offset
        .checked_add(sidx.end as u64)?
        .checked_add(first_offset)?;
    let mut segments = Vec::with_capacity(reference_count);
    for _ in 0..reference_count {
        let raw_size = be32(payload, pos)? as u64;
        let is_index = raw_size >> 31 == 1;
        let size = raw_size & 0x7FFF_FFFF;
        let duration = be32(payload, pos + 4)? as u64;
        // pos + 8: starts_with_SAP, SAP_type, SAP_delta_time — not needed.
        if is_index || size == 0 {
            return None;
        }
        let duration_us = ticks_to_us(duration, timescale);
        let start_us = time_us;
        time_us = time_us.saturating_add(duration_us);
        let byte_start = byte_cursor;
        byte_cursor = byte_cursor.checked_add(size)?;
        segments.push(Segment {
            start_us,
            end_us: time_us,
            byte_start,
            byte_end: byte_cursor - 1,
        });
        pos += 12;
    }
    Some(segments)
}

/// One top-level box in a byte string: its type and where its payload ends.
struct BoxSpan {
    kind: [u8; 4],
    payload_start: usize,
    end: usize,
}

/// Scans the top-level boxes of `bytes`. `None` when a header is truncated
/// or a box runs past the buffer; trailing all-zero padding ends the scan.
fn top_level_boxes(bytes: &[u8]) -> Option<Vec<BoxSpan>> {
    let mut spans = Vec::new();
    let mut pos = 0;
    while pos < bytes.len() {
        if bytes.len() - pos < 8 {
            if bytes[pos..].iter().all(|byte| *byte == 0) {
                break;
            }
            return None;
        }
        let size32 = be32(bytes, pos)? as u64;
        let mut kind = [0_u8; 4];
        kind.copy_from_slice(&bytes[pos + 4..pos + 8]);
        let (header, size) = if size32 == 0 {
            (8, (bytes.len() - pos) as u64)
        } else if size32 == 1 {
            if bytes.len() - pos < 16 {
                return None;
            }
            (16, be64(bytes, pos + 8)?)
        } else {
            (8, size32)
        };
        if size < header as u64 {
            return None;
        }
        let end = pos.checked_add(size as usize)?;
        if end > bytes.len() {
            return None;
        }
        spans.push(BoxSpan {
            kind,
            payload_start: pos + header,
            end,
        });
        pos = end;
    }
    Some(spans)
}

/// The segments of one DASH stream from its WebM `Cues` element, the
/// counterpart of [`parse_sidx`] for MP4. A WebM stream has no sidx; its
/// index is the Cues element the format's `indexRange` points at, and its
/// timescale lives in the init segment's Info element.
///
/// Each CuePoint gives a CueTime (in TimestampScale units) and a
/// CueClusterPosition (segment-relative byte offset of a Cluster); a segment
/// runs from one cluster position to the next cluster's position minus one,
/// and the last cluster runs to the file's total size. The init segment is
/// bytes [0, first cluster).
pub fn parse_webm_cues(
    init_bytes: &[u8],
    index_bytes: &[u8],
    content_length: Option<u64>,
) -> Option<Vec<Segment>> {
    let segment_data_start = segment_data_start(init_bytes)?;
    let timescale_ns = timestamp_scale_ns(init_bytes, segment_data_start)?;
    let cues = cue_points(index_bytes)?;
    if cues.is_empty() {
        return None;
    }
    let total = content_length.filter(|length| *length > 0)?;
    // DASH WebM is single-track, but dedupe by cluster position anyway:
    // duplicate CuePoints (one per track) would otherwise split one cluster
    // into zero-length parts.
    let mut distinct: Vec<(u64, u64)> = Vec::new();
    {
        let mut by_position: Vec<(u64, u64)> = cues;
        by_position.sort_by_key(|point| point.1);
        for (time, position) in by_position {
            match distinct.last_mut() {
                Some(last) if last.1 == position => {
                    last.0 = last.0.min(time);
                }
                _ => distinct.push((time, position)),
            }
        }
        distinct.sort_by_key(|point| point.0);
    }
    let mut segments = Vec::with_capacity(distinct.len());
    for (index, (cue_time, cluster_pos)) in distinct.iter().enumerate() {
        let start_us = mul_div_u64(*cue_time, timescale_ns, 1000);
        let byte_start = segment_data_start.checked_add(*cluster_pos)?;
        if index == 0 && byte_start < init_bytes.len() as u64 {
            return None;
        }
        if index + 1 < distinct.len() {
            let (next_time, next_pos) = distinct[index + 1];
            let byte_end = segment_data_start.checked_add(next_pos)?.checked_sub(1)?;
            if byte_end < byte_start {
                return None;
            }
            segments.push(Segment {
                start_us,
                end_us: mul_div_u64(next_time, timescale_ns, 1000),
                byte_start,
                byte_end,
            });
        } else {
            // The last cluster runs to the end of the file; its end time is
            // unbounded — the overlap filter selects it whenever the clip
            // reaches it, and the remux trims the exact end.
            if total - 1 < byte_start {
                return None;
            }
            segments.push(Segment {
                start_us,
                end_us: u64::MAX,
                byte_start,
                byte_end: total - 1,
            });
        }
    }
    Some(segments)
}

/// Byte offset where the Segment body's first child starts, parsed from the
/// init bytes.
fn segment_data_start(init_bytes: &[u8]) -> Option<u64> {
    let mut pos = 0;
    let (ebml_id, ebml_id_len) = read_elem_id(init_bytes, pos)?;
    if ebml_id != ID_EBML {
        return None;
    }
    pos += ebml_id_len;
    let (ebml_size, ebml_size_len) = read_vint(init_bytes, pos)?;
    pos += ebml_size_len + ebml_size as usize;
    if pos >= init_bytes.len() {
        return None;
    }
    let (segment_id, segment_id_len) = read_elem_id(init_bytes, pos)?;
    if segment_id != ID_SEGMENT {
        return None;
    }
    pos += segment_id_len;
    let (_, segment_size_len) = read_vint(init_bytes, pos)?;
    Some((pos + segment_size_len) as u64)
}

/// TimestampScale in nanoseconds, from the init bytes' Info element; the
/// default 1_000_000 when the Info element carries none.
fn timestamp_scale_ns(init_bytes: &[u8], segment_data_start: u64) -> Option<u64> {
    let mut pos = segment_data_start as usize;
    while pos < init_bytes.len() {
        let (id, id_len) = read_elem_id(init_bytes, pos)?;
        pos += id_len;
        let (size, size_len) = read_vint(init_bytes, pos)?;
        pos += size_len;
        let end = (pos + size as usize).min(init_bytes.len());
        if id == ID_INFO {
            let mut inner = pos;
            while inner < end {
                let (field_id, field_id_len) = read_elem_id(init_bytes, inner)?;
                inner += field_id_len;
                let (field_size, field_size_len) = read_vint(init_bytes, inner)?;
                inner += field_size_len;
                let field_end = (inner + field_size as usize).min(end);
                if field_id == ID_TIMESTAMP_SCALE {
                    let scale = read_uint(init_bytes, inner, field_size as usize)?;
                    if scale == 0 {
                        return None;
                    }
                    return Some(scale);
                }
                inner = field_end;
            }
            return Some(DEFAULT_TIMESTAMP_SCALE_NS);
        }
        // Unknown-size child elements run to the end of the init segment.
        pos = if is_vint_unknown(size, size_len) {
            init_bytes.len()
        } else {
            end
        };
    }
    Some(DEFAULT_TIMESTAMP_SCALE_NS)
}

/// (CueTime, CueClusterPosition) pairs from the Cues element bytes.
fn cue_points(index_bytes: &[u8]) -> Option<Vec<(u64, u64)>> {
    let mut pos = 0;
    let (cues_id, cues_id_len) = read_elem_id(index_bytes, pos)?;
    if cues_id != ID_CUES {
        return None;
    }
    pos += cues_id_len;
    let (cues_size, cues_size_len) = read_vint(index_bytes, pos)?;
    pos += cues_size_len;
    let cues_end = if is_vint_unknown(cues_size, cues_size_len) {
        index_bytes.len()
    } else {
        (pos + cues_size as usize).min(index_bytes.len())
    };
    let mut points = Vec::new();
    while pos < cues_end {
        let (id, id_len) = read_elem_id(index_bytes, pos)?;
        pos += id_len;
        let (size, size_len) = read_vint(index_bytes, pos)?;
        pos += size_len;
        let end = (pos + size as usize).min(cues_end);
        if id == ID_CUE_POINT {
            let mut cue_time: Option<u64> = None;
            let mut cluster_pos: Option<u64> = None;
            let mut inner = pos;
            while inner < end {
                let (field_id, field_id_len) = read_elem_id(index_bytes, inner)?;
                inner += field_id_len;
                let (field_size, field_size_len) = read_vint(index_bytes, inner)?;
                inner += field_size_len;
                let field_end = (inner + field_size as usize).min(end);
                match field_id {
                    ID_CUE_TIME => cue_time = read_uint(index_bytes, inner, field_size as usize),
                    ID_CUE_TRACK_POSITIONS => {
                        let mut nested = inner;
                        while nested < field_end {
                            let (nested_id, nested_id_len) = read_elem_id(index_bytes, nested)?;
                            nested += nested_id_len;
                            let (nested_size, nested_size_len) = read_vint(index_bytes, nested)?;
                            nested += nested_size_len;
                            let nested_end = (nested + nested_size as usize).min(field_end);
                            if nested_id == ID_CUE_CLUSTER_POSITION {
                                cluster_pos = read_uint(index_bytes, nested, nested_size as usize);
                            }
                            nested = nested_end;
                        }
                    }
                    _ => {}
                }
                inner = field_end;
            }
            if let (Some(time), Some(position)) = (cue_time, cluster_pos) {
                points.push((time, position));
            }
        }
        pos = end;
    }
    Some(points)
}

/// Reads a variable-length EBML integer: (value, bytes consumed), or `None`
/// when truncated.
fn read_vint(data: &[u8], pos: usize) -> Option<(u64, usize)> {
    if pos >= data.len() {
        return None;
    }
    let first = data[pos];
    let width = first.leading_zeros() as usize + 1;
    if width > 8 || pos + width > data.len() {
        return None;
    }
    let mask = (1_u64 << (8 - width)) - 1;
    let mut value = u64::from(first) & mask;
    for index in 1..width {
        value = (value << 8) | u64::from(data[pos + index]);
    }
    Some((value, width))
}

/// Reads an EBML element ID (up to 4 bytes): (id, bytes consumed), or `None`
/// when truncated.
fn read_elem_id(data: &[u8], pos: usize) -> Option<(u64, usize)> {
    if pos >= data.len() {
        return None;
    }
    let first = data[pos];
    let width = first.leading_zeros() as usize + 1;
    if width > 4 || pos + width > data.len() {
        return None;
    }
    let mut id = u64::from(first);
    for index in 1..width {
        id = (id << 8) | u64::from(data[pos + index]);
    }
    Some((id, width))
}

/// Reads a big-endian unsigned integer of `size` bytes, or `None` when
/// truncated.
fn read_uint(data: &[u8], pos: usize, size: usize) -> Option<u64> {
    if size == 0 || size > 8 || pos + size > data.len() {
        return None;
    }
    let mut value = 0_u64;
    for index in 0..size {
        value = (value << 8) | u64::from(data[pos + index]);
    }
    Some(value)
}

/// A VINT whose data bits are all 1 is the EBML unknown-size sentinel for its
/// width.
fn is_vint_unknown(value: u64, width: usize) -> bool {
    if !(1..=8).contains(&width) {
        return false;
    }
    value == (1_u64 << (7 * width)) - 1
}

fn be16(bytes: &[u8], pos: usize) -> Option<u16> {
    Some(u16::from_be_bytes(
        bytes.get(pos..pos + 2)?.try_into().ok()?,
    ))
}

fn be32(bytes: &[u8], pos: usize) -> Option<u32> {
    Some(u32::from_be_bytes(
        bytes.get(pos..pos + 4)?.try_into().ok()?,
    ))
}

fn be64(bytes: &[u8], pos: usize) -> Option<u64> {
    Some(u64::from_be_bytes(
        bytes.get(pos..pos + 8)?.try_into().ok()?,
    ))
}

/// Ticks at `timescale` per second, in microseconds (saturating).
fn ticks_to_us(ticks: u64, timescale: u64) -> u64 {
    mul_div_u64(ticks, 1_000_000, timescale)
}

/// `a * b / c` without overflowing on large tick counts.
fn mul_div_u64(a: u64, b: u64, c: u64) -> u64 {
    if c == 0 {
        return u64::MAX;
    }
    u64::try_from((u128::from(a) * u128::from(b)) / u128::from(c)).unwrap_or(u64::MAX)
}

const ID_EBML: u64 = 0x1A45DFA3;
const ID_SEGMENT: u64 = 0x18538067;
const ID_INFO: u64 = 0x1549A966;
const ID_TIMESTAMP_SCALE: u64 = 0x2AD7B1;
const ID_CUES: u64 = 0x1C53BB6B;
const ID_CUE_POINT: u64 = 0xBB;
const ID_CUE_TIME: u64 = 0xB3;
const ID_CUE_TRACK_POSITIONS: u64 = 0xB7;
const ID_CUE_CLUSTER_POSITION: u64 = 0xF1;
const DEFAULT_TIMESTAMP_SCALE_NS: u64 = 1_000_000;

#[cfg(test)]
mod tests {
    use super::{Segment, parse_sidx, parse_webm_cues};

    fn sidx_box(version: u8, timescale: u32, earliest: u64, first_offset: u64) -> Vec<u8> {
        // Two references: 500 bytes over 5 s, then 700 bytes over 5 s.
        let mut payload = Vec::new();
        payload.push(version);
        payload.extend_from_slice(&[0, 0, 0]); // flags
        payload.extend_from_slice(&1_u32.to_be_bytes()); // reference_ID
        payload.extend_from_slice(&timescale.to_be_bytes());
        if version == 0 {
            payload.extend_from_slice(&(earliest as u32).to_be_bytes());
            payload.extend_from_slice(&(first_offset as u32).to_be_bytes());
        } else {
            payload.extend_from_slice(&earliest.to_be_bytes());
            payload.extend_from_slice(&first_offset.to_be_bytes());
        }
        payload.extend_from_slice(&[0, 0]); // reserved
        payload.extend_from_slice(&2_u16.to_be_bytes()); // reference_count
        for (size, duration) in [(500_u32, 5000_u32), (700_u32, 5000_u32)] {
            payload.extend_from_slice(&size.to_be_bytes());
            payload.extend_from_slice(&duration.to_be_bytes());
            payload.extend_from_slice(&0_u32.to_be_bytes()); // SAP
        }
        let mut boxed = Vec::new();
        boxed.extend_from_slice(&((8 + payload.len()) as u32).to_be_bytes());
        boxed.extend_from_slice(b"sidx");
        boxed.extend_from_slice(&payload);
        boxed
    }

    #[test]
    fn sidx_v0_maps_segments_to_bytes_and_time() {
        let index = sidx_box(0, 1000, 0, 100);
        // The sidx box is 8 + 48 = 56 bytes; the first segment starts 100
        // bytes after its end, at file offset 156.
        let segments = parse_sidx(&index, 0).expect("parses");
        assert_eq!(
            segments,
            vec![
                Segment {
                    start_us: 0,
                    end_us: 5_000_000,
                    byte_start: 156,
                    byte_end: 655,
                },
                Segment {
                    start_us: 5_000_000,
                    end_us: 10_000_000,
                    byte_start: 656,
                    byte_end: 1355,
                },
            ]
        );
    }

    #[test]
    fn sidx_v1_reads_64_bit_times() {
        let index = sidx_box(1, 1000, 2_000_000, 100);
        let segments = parse_sidx(&index, 0).expect("parses");
        assert_eq!(segments[0].start_us, 2_000_000_000);
        assert_eq!(segments[0].end_us, 2_005_000_000);
    }

    #[test]
    fn sidx_rejects_nested_indexes_and_unknown_versions() {
        let mut nested = sidx_box(0, 1000, 0, 100);
        // Mark the first reference as a nested index (top bit of its size).
        let first_ref = nested.len() - 24;
        nested[first_ref] |= 0x80;
        assert!(parse_sidx(&nested, 0).is_none());
        let mut unknown = sidx_box(0, 1000, 0, 100);
        unknown[8] = 2;
        assert!(parse_sidx(&unknown, 0).is_none());
        assert!(parse_sidx(b"not a box at all", 0).is_none());
        assert!(parse_sidx(&[], 0).is_none());
    }

    #[test]
    fn sidx_offsets_are_absolute_to_the_file() {
        // The index bytes were fetched from file offset 1000: segment bytes
        // shift by exactly that.
        let index = sidx_box(0, 1000, 0, 100);
        let segments = parse_sidx(&index, 1000).expect("parses");
        assert_eq!(segments[0].byte_start, 1156);
    }

    /// One EBML element: id bytes + a one-byte size vint + payload.
    fn elem(id: &[u8], payload: &[u8]) -> Vec<u8> {
        let mut out = id.to_vec();
        out.push(0x80 | payload.len() as u8);
        out.extend_from_slice(payload);
        out
    }

    fn uint_bytes(value: u64) -> Vec<u8> {
        let bytes = value.to_be_bytes();
        let first_nonzero = bytes.iter().position(|byte| *byte != 0).unwrap_or(7);
        bytes[first_nonzero..].to_vec()
    }

    fn webm_init() -> Vec<u8> {
        // EBML header (empty) + Segment + Info(TimestampScale = 1_000_000).
        let mut init = elem(&[0x1A, 0x45, 0xDF, 0xA3], &[]);
        let info = elem(
            &[0x15, 0x49, 0xA9, 0x66],
            &elem(&[0x2A, 0xD7, 0xB1], &uint_bytes(1_000_000)),
        );
        // Segment with an unknown size (0xFF): its body starts right after.
        init.extend_from_slice(&[0x18, 0x53, 0x80, 0x67, 0xFF]);
        init.extend_from_slice(&info);
        init
    }

    fn webm_cues() -> Vec<u8> {
        let cue = |time: u64, position: u64| {
            elem(
                &[0xBB],
                &[
                    elem(&[0xB3], &uint_bytes(time)).as_slice(),
                    elem(&[0xB7], &elem(&[0xF1], &uint_bytes(position)).as_slice()).as_slice(),
                ]
                .concat(),
            )
        };
        elem(
            &[0x1C, 0x53, 0xBB, 0x6B],
            // CueTimes are in TimestampScale units (1_000_000 ns = 1 ms here),
            // so the second cluster starts at 5 s.
            &[cue(0, 1000), cue(5000, 6000)].concat(),
        )
    }

    #[test]
    fn webm_cues_map_clusters_to_segments() {
        let init = webm_init();
        let cues = webm_cues();
        // Segment data starts after EBML (5 bytes) + Segment id/size (5
        // bytes): offset 10.
        let segments = parse_webm_cues(&init, &cues, Some(20_000)).expect("parses");
        assert_eq!(
            segments,
            vec![
                Segment {
                    start_us: 0,
                    end_us: 5_000_000,
                    byte_start: 1010,
                    byte_end: 6009,
                },
                Segment {
                    start_us: 5_000_000,
                    end_us: u64::MAX,
                    byte_start: 6010,
                    byte_end: 19_999,
                },
            ]
        );
    }

    #[test]
    fn webm_cues_rejects_a_missing_length_or_bad_magic() {
        let init = webm_init();
        let cues = webm_cues();
        assert!(parse_webm_cues(&init, &cues, None).is_none());
        assert!(parse_webm_cues(&init, b"garbage", Some(20_000)).is_none());
        assert!(parse_webm_cues(b"garbage", &cues, Some(20_000)).is_none());
    }
}
