use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

use webm_iterable::WebmIterator;
use webm_iterable::matroska_spec::{BlockLacing, Master, MatroskaSpec, SimpleBlock};

use crate::api::innertube::download::DownloadContainer;

mod boxes;
pub mod clip;
mod ilst;
pub mod matroska;
mod mp4_demux;
mod mp4_writer;
pub mod retag;
pub mod validate;
mod vp9;

pub use ilst::{EmbeddedChapter, EmbeddedMetadata, MAX_COVER_BYTES};

use super::ClipRange;
use mp4_demux::{Codec, ProgressiveSample, ProgressiveTrack};
use mp4_writer::{Mp4Options, SampleSource, TrackRole, WriterSample, WriterTrack};

/// Bytes left free after `moov` so tags (synced lyrics above all) can be rewritten
/// later without moving the media data.
const RETAG_PADDING: u32 = 64 * 1024;
/// `WebM` timestamps are in milliseconds; 90 kHz keeps them exact in MP4.
const WEBM_VIDEO_TIMESCALE: u32 = 90_000;

/// Which half of an adaptive pair a track is, used for diagnostics and demuxer selection.
#[derive(Clone, Copy)]
enum TrackKind {
    Video,
    Audio,
}

impl TrackKind {
    fn label(self) -> &'static str {
        match self {
            Self::Video => "video track",
            Self::Audio => "audio track",
        }
    }
}

/// One downloaded track: where it is, the container its bytes arrived in, and its
/// mime type (VP9's `vpcC` fields come from the codecs string).
#[derive(Clone, Copy)]
pub struct TrackInput<'a> {
    pub path: &'a Path,
    pub container: DownloadContainer,
    pub mime_type: &'a str,
    /// BCP 47 language code of an audio track, for the output's track
    /// language; `None` writes "und". Video tracks leave this unset.
    pub language_code: Option<&'a str>,
}

/// A BCP 47 language code as the ISO 639-2/T three letters the MP4 `mdhd`
/// packs: the primary subtag, so `es-US` and `es` both become `spa`.
/// Unknown codes fall back to `und`, as the writer did for every track.
fn iso639_2(code: &str) -> [u8; 3] {
    let primary = code
        .split(['-', '_'])
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    if primary.len() == 3 && primary.bytes().all(|byte| byte.is_ascii_lowercase()) {
        return [
            primary.as_bytes()[0],
            primary.as_bytes()[1],
            primary.as_bytes()[2],
        ];
    }
    let three = match primary.as_str() {
        "ar" => "ara",
        "as" => "asm",
        "az" => "aze",
        "bg" => "bul",
        "bn" => "ben",
        "ca" => "cat",
        "cs" => "ces",
        "cy" => "cym",
        "da" => "dan",
        "de" => "deu",
        "el" => "ell",
        "en" => "eng",
        "es" => "spa",
        "eu" => "eus",
        "fa" => "fas",
        "fi" => "fin",
        "fr" => "fra",
        "gl" => "glg",
        "gu" => "guj",
        "he" => "heb",
        "hi" => "hin",
        "hr" => "hrv",
        "hu" => "hun",
        "hy" => "hye",
        "id" => "ind",
        "it" => "ita",
        "ja" => "jpn",
        "ka" => "kat",
        "kk" => "kaz",
        "km" => "khm",
        "kn" => "kan",
        "ko" => "kor",
        "lo" => "lao",
        "ml" => "mal",
        "mn" => "mon",
        "mr" => "mar",
        "ms" => "msa",
        "my" => "mya",
        "nb" => "nob",
        "ne" => "nep",
        "nl" => "nld",
        "no" => "nor",
        "or" => "ori",
        "pa" => "pan",
        "pl" => "pol",
        "pt" => "por",
        "ro" => "ron",
        "ru" => "rus",
        "si" => "sin",
        "sk" => "slk",
        "sr" => "srp",
        "sv" => "swe",
        "sw" => "swa",
        "ta" => "tam",
        "te" => "tel",
        "th" => "tha",
        "tl" => "tgl",
        "tr" => "tur",
        "uk" => "ukr",
        "ur" => "urd",
        "uz" => "uzb",
        "vi" => "vie",
        "zh" => "zho",
        "am" => "amh",
        _ => "und",
    };
    [
        three.as_bytes()[0],
        three.as_bytes()[1],
        three.as_bytes()[2],
    ]
}

/// Muxes a downloaded video and audio track into a single output file.
///
/// `output` selects the destination container; each input's `container` is the one
/// its bytes really arrived in, which can differ from `output`: AV1 ships as
/// fragmented MP4 and VP9 as `WebM`, and both end up in MP4 next to AAC.
/// `audios` holds every ticked language, primary first — each becomes its own
/// audio track in the one file. `clip` keeps only `[clip.start_ms, clip.end_ms)`
/// of each track; `None` is today's full download, byte for byte.
pub fn mux_adaptive_tracks(
    output: DownloadContainer,
    video: TrackInput<'_>,
    audios: &[TrackInput<'_>],
    output_path: &Path,
    metadata: Option<&EmbeddedMetadata>,
    cancelled: &AtomicBool,
    clip: Option<ClipRange>,
) -> Result<(), String> {
    if audios.is_empty() {
        return Err("A video download needs at least one audio track".into());
    }
    match output {
        DownloadContainer::Mp4 => mux_mp4(video, audios, output_path, metadata, cancelled, clip),
        DownloadContainer::Mkv => {
            let (video_entry, video_packets) =
                open_track_source(video.container, video.path, 1, TrackKind::Video, clip)?;
            let mut inputs = vec![matroska::MatroskaInput {
                entry: video_entry,
                packets: video_packets,
                is_video: true,
            }];
            for (index, audio) in audios.iter().enumerate() {
                let output_track = u64::try_from(index + 2).unwrap_or(u64::MAX);
                let (audio_entry, audio_packets) = open_track_source(
                    audio.container,
                    audio.path,
                    output_track,
                    TrackKind::Audio,
                    clip,
                )?;
                inputs.push(matroska::MatroskaInput {
                    entry: audio_entry,
                    packets: audio_packets,
                    is_video: false,
                });
            }
            matroska::write_matroska(output_path, inputs, metadata, cancelled)
        }
    }
}

/// Writes a progressive MP4 from a fragmented-MP4 or `WebM` VP9 video track and a
/// fragmented-MP4 AAC track, with the tags and cover in `moov/udta`.
fn mux_mp4(
    video: TrackInput<'_>,
    audios: &[TrackInput<'_>],
    output_path: &Path,
    metadata: Option<&EmbeddedMetadata>,
    cancelled: &AtomicBool,
    clip: Option<ClipRange>,
) -> Result<(), String> {
    let (video_track, video_codec) = match video.container {
        DownloadContainer::Mp4 => {
            let track = mp4_demux::open_progressive(video.path, TrackKind::Video)?;
            if matches!(track.codec, Codec::Vp8) {
                return Err("VP8 video cannot be stored in MP4".to_string());
            }
            let codec = track.codec;
            (
                fragmented_writer_track(track, TrackKind::Video, clip)?,
                codec,
            )
        }
        DownloadContainer::Mkv => (
            webm_vp9_writer_track(video.path, video.mime_type, clip)?,
            Codec::Vp9,
        ),
    };
    let mut tracks = vec![video_track];
    for audio in audios {
        if audio.container != DownloadContainer::Mp4 {
            return Err("MP4 downloads need an AAC audio track".to_string());
        }
        let audio_track = mp4_demux::open_progressive(audio.path, TrackKind::Audio)?;
        if !matches!(audio_track.codec, Codec::Aac) {
            return Err("MP4 downloads need an AAC audio track".to_string());
        }
        let mut audio_track = fragmented_writer_track(audio_track, TrackKind::Audio, clip)?;
        audio_track.language = audio.language_code.map(iso639_2);
        tracks.push(audio_track);
    }

    let mut compatible_brands = vec![*b"isom", *b"iso2", *b"mp41"];
    match video_codec {
        Codec::H264 => compatible_brands.push(*b"avc1"),
        Codec::Av1 => compatible_brands.push(*b"av01"),
        _ => {}
    }
    let options = Mp4Options {
        major_brand: *b"isom",
        compatible_brands,
        udta: metadata.map(ilst::udta_box),
        padding: RETAG_PADDING,
    };
    mp4_writer::write_mp4(output_path, tracks, &options, cancelled)
}

/// Rewrites a downloaded fragmented AAC track as a progressive, tagged M4A.
pub fn remux_audio_to_m4a(
    input: &Path,
    output: &Path,
    metadata: Option<&EmbeddedMetadata>,
    cancelled: &AtomicBool,
    clip: Option<ClipRange>,
) -> Result<(), String> {
    let track = mp4_demux::open_progressive(input, TrackKind::Audio)?;
    if !matches!(track.codec, Codec::Aac) {
        return Err("Only AAC audio is saved as M4A".to_string());
    }
    let options = Mp4Options {
        major_brand: *b"M4A ",
        compatible_brands: vec![*b"M4A ", *b"isom", *b"iso2", *b"mp42"],
        udta: metadata.map(ilst::udta_box),
        padding: RETAG_PADDING,
    };
    mp4_writer::write_mp4(
        output,
        vec![fragmented_writer_track(track, TrackKind::Audio, clip)?],
        &options,
        cancelled,
    )
}

impl SampleSource for ProgressiveTrack {
    fn read_sample(&mut self, index: usize, _sample: &WriterSample) -> Result<Vec<u8>, String> {
        let sample: ProgressiveSample = *self
            .samples
            .get(index)
            .ok_or_else(|| format!("MP4 sample {index} is out of range"))?;
        ProgressiveTrack::read_sample(self, sample)
    }
}

fn fragmented_writer_track(
    mut track: ProgressiveTrack,
    kind: TrackKind,
    clip: Option<ClipRange>,
) -> Result<WriterTrack<'static>, String> {
    let mut samples: Vec<WriterSample> = track
        .samples
        .iter()
        .map(|sample| WriterSample {
            size: sample.size,
            duration: sample.duration,
            composition_offset: sample.composition_offset,
            is_sync: sample.is_sync,
        })
        .collect();
    let role = match kind {
        TrackKind::Video => TrackRole::Video {
            width: track.width,
            height: track.height,
        },
        TrackKind::Audio => TrackRole::Audio,
    };
    let mut media_time = track
        .edit_media_time
        .or_else(|| first_presentation_time(&samples));
    if let Some(clip) = clip {
        // The track's own samples are filtered to the same kept indices as the
        // writer's list, so the source still answers each index with its bytes.
        // A segment-only part starts mid-stream: its samples' absolute decode
        // times begin at the first fragment's tfdt, so the clip range (absolute
        // media time) is shifted back by that base before trimming. A full
        // download's first fragment starts at zero, so this changes nothing
        // there.
        let media_offset = track
            .edit_media_time
            .unwrap_or(0)
            .saturating_sub(track.first_decode_time as i64);
        let trimmed = clip::trim_samples(
            &samples,
            track.timescale,
            matches!(kind, TrackKind::Video),
            media_offset,
            clip,
        )
        .map_err(|error| format!("{}: {error}", kind.label()))?;
        track.samples = trimmed
            .indices
            .iter()
            .map(|index| track.samples[*index])
            .collect();
        samples = trimmed
            .indices
            .iter()
            .map(|index| samples[*index])
            .collect();
        media_time = Some(trimmed.media_time);
    }
    Ok(WriterTrack {
        role,
        timescale: track.timescale,
        sample_entry: track.sample_entry.clone(),
        samples,
        media_time,
        language: None,
        source: Box::new(track),
    })
}

/// The earliest presentation time when the stream starts after zero, as B-frame
/// video does when the source declared no edit list.
fn first_presentation_time(samples: &[WriterSample]) -> Option<i64> {
    let mut decode = 0_i64;
    let mut earliest: Option<i64> = None;
    for sample in samples.iter().take(256) {
        let presentation = decode + i64::from(sample.composition_offset);
        earliest = Some(earliest.map_or(presentation, |value| value.min(presentation)));
        decode += i64::from(sample.duration);
    }
    earliest.filter(|time| *time > 0)
}

/// Reads a `WebM` VP9 track's frames in order for the MP4 writer.
struct WebmFrameSource {
    track: MatroskaTrack,
    next: usize,
}

impl SampleSource for WebmFrameSource {
    fn read_sample(&mut self, index: usize, _sample: &WriterSample) -> Result<Vec<u8>, String> {
        if index != self.next {
            return Err(format!(
                "WebM frames must be read in order (wanted {index}, at {})",
                self.next
            ));
        }
        self.next += 1;
        self.track
            .next_packet()?
            .map(|packet| packet.data)
            .ok_or_else(|| "The WebM video track ended early".to_string())
    }
}

fn webm_vp9_writer_track(
    path: &Path,
    mime_type: &str,
    clip: Option<ClipRange>,
) -> Result<WriterTrack<'static>, String> {
    let (entry, source_track) = read_matroska_track_entry(path, 1, TrackKind::Video.label())?;
    let (codec_id, width, height, default_duration) = webm_video_info(&entry);
    if codec_id.as_deref() != Some("V_VP9") {
        return Err(format!(
            "Only VP9 WebM video can be stored in MP4 (got {})",
            codec_id.unwrap_or_else(|| "an unknown codec".to_string())
        ));
    }

    let mut scan = MatroskaTrack::open(path, source_track, TrackKind::Video.label())?;
    let mut frames: Vec<(i128, u32, bool)> = Vec::new();
    let mut first_keyframe: Option<Vec<u8>> = None;
    while let Some(packet) = scan.next_packet()? {
        if packet.keyframe && first_keyframe.is_none() {
            first_keyframe = Some(packet.data.clone());
        }
        let size = u32::try_from(packet.data.len())
            .map_err(|_| "A WebM video frame is larger than 4 GiB".to_string())?;
        frames.push((packet.timestamp_ns, size, packet.keyframe));
    }
    if frames.is_empty() {
        return Err("The WebM video track has no frames".to_string());
    }

    let ticks = |ns: i128| -> i64 {
        i64::try_from(ns * i128::from(WEBM_VIDEO_TIMESCALE) / 1_000_000_000).unwrap_or(0)
    };
    // A clip keeps one run of frames: the keyframe at or before the start
    // through the last frame before the end. WebM times are absolute, so the
    // track's media offset is zero and decode order is file order.
    let mut skip = 0_usize;
    let mut media_time = None;
    if let Some(clip) = clip {
        let presentations: Vec<i64> = frames
            .iter()
            .map(|(timestamp, _, _)| ticks(*timestamp))
            .collect();
        let is_sync: Vec<bool> = frames.iter().map(|(_, _, keyframe)| *keyframe).collect();
        let trimmed = clip::select_range(
            &presentations,
            &presentations,
            &is_sync,
            true,
            ticks(i128::from(clip.start_ms) * 1_000_000),
            ticks(i128::from(clip.end_ms) * 1_000_000),
        )
        .map_err(|error| format!("video track: {error}"))?;
        skip = trimmed.indices[0];
        media_time = Some(trimmed.media_time);
        frames = trimmed.indices.iter().map(|index| frames[*index]).collect();
    }
    let fallback = default_duration
        .map(|ns| ticks(i128::from(ns)))
        .filter(|value| *value > 0)
        .unwrap_or(i64::from(WEBM_VIDEO_TIMESCALE / 30));
    let mut samples = Vec::with_capacity(frames.len());
    let mut previous_duration = fallback;
    for (index, (timestamp, size, keyframe)) in frames.iter().enumerate() {
        let duration = frames
            .get(index + 1)
            .map_or(previous_duration, |(next, _, _)| {
                ticks(*next) - ticks(*timestamp)
            })
            .max(1);
        previous_duration = duration;
        samples.push(WriterSample {
            size: *size,
            duration: u32::try_from(duration).unwrap_or(u32::MAX),
            composition_offset: 0,
            is_sync: *keyframe,
        });
    }

    let config = vp9::Vp9Config::resolve(mime_type, first_keyframe.as_deref());
    // The source re-reads the file from the start, so the dropped leading
    // frames are skipped before the writer asks for its first sample.
    let mut source_track = MatroskaTrack::open(path, source_track, TrackKind::Video.label())?;
    for _ in 0..skip {
        source_track.next_packet()?;
    }
    Ok(WriterTrack {
        role: TrackRole::Video { width, height },
        timescale: WEBM_VIDEO_TIMESCALE,
        sample_entry: vp9::vp09_sample_entry(width, height, config),
        samples,
        media_time,
        language: None,
        source: Box::new(WebmFrameSource {
            track: source_track,
            next: 0,
        }),
    })
}

/// Codec ID, pixel size and default frame duration (ns) of a `WebM` video entry.
fn webm_video_info(entry: &MatroskaSpec) -> (Option<String>, u16, u16, Option<u64>) {
    let MatroskaSpec::TrackEntry(Master::Full(children)) = entry else {
        return (None, 0, 0, None);
    };
    let mut codec_id = None;
    let mut width = 0;
    let mut height = 0;
    let mut default_duration = None;
    for child in children {
        match child {
            MatroskaSpec::CodecID(id) => codec_id = Some(id.clone()),
            MatroskaSpec::DefaultDuration(ns) => default_duration = Some(*ns),
            MatroskaSpec::Video(Master::Full(video)) => {
                for field in video {
                    match field {
                        MatroskaSpec::PixelWidth(value) => {
                            width = u16::try_from(*value).unwrap_or(u16::MAX);
                        }
                        MatroskaSpec::PixelHeight(value) => {
                            height = u16::try_from(*value).unwrap_or(u16::MAX);
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    (codec_id, width, height, default_duration)
}

/// A single coded frame, normalized so video (`WebM` or fragmented MP4) and audio
/// (`WebM`) tracks interleave through one Matroska writer.
#[derive(Clone)]
struct MatroskaPacket {
    timestamp_ns: i128,
    data: Vec<u8>,
    lacing: Option<BlockLacing>,
    invisible: bool,
    discardable: bool,
    keyframe: bool,
}

/// A demuxed track that yields [`MatroskaPacket`]s regardless of its source container.
/// The `WebM` iterator carries large internal buffers, so it is boxed to keep the
/// two variants similarly sized.
enum PacketSource {
    Webm(Box<MatroskaTrack>),
    Mp4(mp4_demux::SampleReader),
    /// A clip of another source: only the clip range reaches the writer.
    Clip(Box<clip::ClipPackets>),
}

impl PacketSource {
    fn next_packet(&mut self) -> Result<Option<MatroskaPacket>, String> {
        match self {
            Self::Webm(track) => track.next_packet(),
            Self::Mp4(reader) => reader.next_packet(),
            Self::Clip(clipped) => clipped.next_packet(),
        }
    }
}

fn open_track_source(
    container: DownloadContainer,
    path: &Path,
    output_track: u64,
    kind: TrackKind,
    clip: Option<ClipRange>,
) -> Result<(MatroskaSpec, PacketSource), String> {
    let (entry, source) = match container {
        DownloadContainer::Mkv => {
            let (entry, source_track) =
                read_matroska_track_entry(path, output_track, kind.label())?;
            let track = MatroskaTrack::open(path, source_track, kind.label())?;
            (entry, PacketSource::Webm(Box::new(track)))
        }
        DownloadContainer::Mp4 => {
            let (entry, reader) = mp4_demux::open(path, output_track, kind)?;
            (entry, PacketSource::Mp4(reader))
        }
    };
    let source = match clip {
        Some(clip) => PacketSource::Clip(Box::new(clip::ClipPackets::new(
            source,
            matches!(kind, TrackKind::Video),
            clip,
        ))),
        None => source,
    };
    Ok((entry, source))
}

struct MatroskaTrack {
    iterator: WebmIterator<File>,
    track_number: u64,
    timestamp_scale: u64,
    cluster_timestamp: i64,
    source_label: &'static str,
    source_path: PathBuf,
}

impl MatroskaTrack {
    fn open(path: &Path, track_number: u64, source_label: &'static str) -> Result<Self, String> {
        let file = File::open(path).map_err(|error| {
            format!(
                "Could not open Matroska {source_label} `{}`: {error}",
                path.display()
            )
        })?;
        Ok(Self {
            iterator: WebmIterator::new(file, &[]),
            track_number,
            timestamp_scale: 1_000_000,
            cluster_timestamp: 0,
            source_label,
            source_path: path.to_path_buf(),
        })
    }

    fn next_packet(&mut self) -> Result<Option<MatroskaPacket>, String> {
        for tag in self.iterator.by_ref() {
            let tag = tag.map_err(|error| {
                format!(
                    "Invalid Matroska {} packet stream in `{}`: {error}",
                    self.source_label,
                    self.source_path.display()
                )
            })?;
            match tag {
                MatroskaSpec::TimestampScale(scale) => self.timestamp_scale = scale.max(1),
                MatroskaSpec::Timestamp(timestamp) => {
                    self.cluster_timestamp = i64::try_from(timestamp)
                        .map_err(|_| "Matroska cluster timestamp is too large".to_string())?;
                }
                MatroskaSpec::SimpleBlock(data) => {
                    let block = SimpleBlock::try_from(data.as_slice())
                        .map_err(|error| format!("Invalid Matroska block: {error}"))?;
                    if block.track != self.track_number {
                        continue;
                    }
                    let absolute_ticks =
                        i128::from(self.cluster_timestamp) + i128::from(block.timestamp);
                    return Ok(Some(MatroskaPacket {
                        timestamp_ns: absolute_ticks * i128::from(self.timestamp_scale),
                        data: block.raw_frame_data().to_vec(),
                        lacing: block.lacing,
                        invisible: block.invisible,
                        discardable: block.discardable,
                        keyframe: block.keyframe,
                    }));
                }
                _ => {}
            }
        }
        Ok(None)
    }
}

fn read_matroska_track_entry(
    path: &Path,
    output_track: u64,
    source_label: &'static str,
) -> Result<(MatroskaSpec, u64), String> {
    let diagnostics = media_file_diagnostics(path);
    let file = File::open(path).map_err(|error| {
        format!(
            "Could not open Matroska {source_label} `{}`: {error}",
            path.display()
        )
    })?;
    let iterator = WebmIterator::new(file, &[MatroskaSpec::TrackEntry(Master::Start)]);
    for tag in iterator {
        let tag = tag.map_err(|error| {
            format!(
                "Invalid Matroska {source_label} metadata in `{}` ({diagnostics}): {error}",
                path.display()
            )
        })?;
        let MatroskaSpec::TrackEntry(Master::Full(mut children)) = tag else {
            continue;
        };
        let source_track = children.iter().find_map(|child| match child {
            MatroskaSpec::TrackNumber(number) => Some(*number),
            _ => None,
        });
        let track_type = children.iter().find_map(|child| match child {
            MatroskaSpec::TrackType(value) => Some(*value),
            _ => None,
        });
        let wanted_type = if output_track == 1 { 1 } else { 2 };
        if track_type != Some(wanted_type) {
            continue;
        }
        for child in &mut children {
            match child {
                MatroskaSpec::TrackNumber(number) | MatroskaSpec::TrackUID(number) => {
                    *number = output_track;
                }
                _ => {}
            }
        }
        return Ok((
            MatroskaSpec::TrackEntry(Master::Full(children)),
            source_track.unwrap_or(1),
        ));
    }
    Err(if output_track == 1 {
        "The source WebM does not contain a video track".to_string()
    } else {
        "The source WebM does not contain an audio track".to_string()
    })
}

fn media_file_diagnostics(path: &Path) -> String {
    let size = path.metadata().map_or(0, |metadata| metadata.len());
    let mut prefix = [0_u8; 32];
    let read = File::open(path)
        .and_then(|mut file| file.read(&mut prefix))
        .unwrap_or(0);
    let prefix = prefix[..read]
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(" ");
    format!("size={size} bytes, first {read} bytes=[{prefix}]")
}

#[cfg(test)]
pub(super) fn scratch_file(tag: &str, extension: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or_default();
    let dir = std::env::temp_dir().join(format!(
        "youglidetube-mux-{tag}-{}-{nanos}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).expect("scratch dir");
    dir.join(format!("out.{extension}"))
}

/// A small playable song with no tags, for tests of what handles finished files.
#[cfg(test)]
pub(super) fn write_test_song(path: &Path) {
    use mp4_writer::tests::{audio_track, options, samples};
    mp4_writer::write_mp4(
        path,
        vec![audio_track(samples(200, 50, 1024, 1))],
        &options(),
        &AtomicBool::new(false),
    )
    .expect("writes");
}

#[cfg(test)]
mod tests {
    use super::mp4_demux::{Codec, ProgressiveSample, ProgressiveTrack};
    use super::mp4_writer::tests::{audio_track, options, samples, video_track};
    use super::validate::inspect_mp4_bytes;
    use super::{
        ClipRange, TrackKind, WriterSample, first_presentation_time, fragmented_writer_track,
    };
    use super::{clip, mp4_writer};
    use std::sync::atomic::AtomicBool;

    fn sample(duration: u32, composition_offset: i32) -> WriterSample {
        WriterSample {
            size: 1,
            duration,
            composition_offset,
            is_sync: true,
        }
    }

    #[test]
    fn b_frame_streams_start_at_their_first_presented_frame() {
        let samples = [sample(1000, 2000), sample(1000, 4000), sample(1000, 0)];
        assert_eq!(first_presentation_time(&samples), Some(2000));
        assert_eq!(first_presentation_time(&[sample(1000, 0)]), None);
    }

    #[test]
    fn a_clipped_track_keeps_its_kept_samples_and_their_bytes() {
        // A synthetic fragmented track: 3 s of 30 fps video, a keyframe every
        // 30 frames. The clip [1.1 s, 2.0 s) keeps the GOP that began at 1.0 s.
        let path = super::scratch_file("clip-track", "mp4");
        let mut file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(true)
            .open(&path)
            .expect("scratch file");
        // Every byte holds its own offset, so a read proves which sample it was.
        use std::io::Write as _;
        let bytes: Vec<u8> = (0..=255).collect();
        file.write_all(&bytes).expect("writes scratch bytes");
        let track = ProgressiveTrack {
            file,
            codec: Codec::H264,
            timescale: 90_000,
            width: 640,
            height: 360,
            sample_entry: vec![0; 78],
            edit_media_time: None,
            first_decode_time: 0,
            samples: (0..90)
                .map(|index| ProgressiveSample {
                    offset: index as u64,
                    size: 10,
                    duration: 3000,
                    composition_offset: 0,
                    is_sync: index % 30 == 0,
                })
                .collect(),
        };
        let writer_track = fragmented_writer_track(
            track,
            TrackKind::Video,
            Some(ClipRange::new(1100, 2000).unwrap()),
        )
        .expect("trims");
        assert_eq!(writer_track.samples.len(), 30);
        assert_eq!(writer_track.media_time, Some(9000));
        // The source still answers each kept index with its own sample: the
        // first kept sample is the keyframe at offset 30, not offset 0.
        let mut source = writer_track.source;
        let first = source
            .read_sample(0, &writer_track.samples[0])
            .expect("reads");
        assert_eq!(first.len(), 10);
        assert_eq!(first[0], 30);
    }

    /// A segment-only part for a clip starting at 44:30: 3 s of 30 fps video
    /// whose first fragment's tfdt is 44:30 in track ticks. The clip range is
    /// absolute media time, so without the tfdt shift it would match nothing
    /// and fail with "clip starts after the end of this track".
    fn segment_part_track(first_decode_time: u64) -> ProgressiveTrack {
        let path = super::scratch_file("clip-segment-part", "mp4");
        let mut file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(true)
            .open(&path)
            .expect("scratch file");
        use std::io::Write as _;
        let bytes: Vec<u8> = (0..=255).collect();
        file.write_all(&bytes).expect("writes scratch bytes");
        ProgressiveTrack {
            file,
            codec: Codec::H264,
            timescale: 90_000,
            width: 640,
            height: 360,
            sample_entry: vec![0; 78],
            edit_media_time: None,
            first_decode_time,
            samples: (0..90)
                .map(|index| ProgressiveSample {
                    offset: index as u64,
                    size: 10,
                    duration: 3000,
                    composition_offset: 0,
                    is_sync: index % 30 == 0,
                })
                .collect(),
        }
    }

    #[test]
    fn a_segment_part_trims_by_absolute_clip_time() {
        // The part's first fragment starts at 44:30 (2_670_000 ms); the clip
        // [44:31, 44:32) is the part's second second, starting on a keyframe.
        let first_decode_time = 2_670_000_u64 * 90;
        let writer_track = fragmented_writer_track(
            segment_part_track(first_decode_time),
            TrackKind::Video,
            Some(ClipRange::new(2_671_000, 2_672_000).unwrap()),
        )
        .expect("trims");
        assert_eq!(writer_track.samples.len(), 30);
        assert_eq!(writer_track.media_time, Some(0));
    }

    #[test]
    fn a_segment_part_clip_starting_mid_gop_skips_to_its_start() {
        // The clip starts halfway through the part's second GOP: the kept
        // samples start at the 44:31 keyframe and the edit list skips 0.5 s.
        let first_decode_time = 2_670_000_u64 * 90;
        let writer_track = fragmented_writer_track(
            segment_part_track(first_decode_time),
            TrackKind::Video,
            Some(ClipRange::new(2_671_500, 2_672_000).unwrap()),
        )
        .expect("trims");
        assert_eq!(writer_track.samples.len(), 30);
        assert_eq!(writer_track.media_time, Some(45_000));
    }

    #[test]
    fn language_codes_become_three_letter_mdhd_tags() {
        assert_eq!(super::iso639_2("en"), *b"eng");
        assert_eq!(super::iso639_2("hi"), *b"hin");
        assert_eq!(super::iso639_2("es-US"), *b"spa");
        assert_eq!(super::iso639_2("zh-Hans"), *b"zho");
        assert_eq!(super::iso639_2("pt-BR"), *b"por");
        assert_eq!(super::iso639_2("und"), *b"und");
        assert_eq!(super::iso639_2("xx"), *b"und");
        assert_eq!(super::iso639_2(""), *b"und");
    }

    #[test]
    fn two_audio_tracks_mux_into_one_file_primary_first() {
        // 2 s of 30 fps video, English then Hindi audio, each tagged.
        let mut english = audio_track(samples(87, 20, 1024, 1));
        english.language = Some(*b"eng");
        let mut hindi = audio_track(samples(87, 20, 1024, 1));
        hindi.language = Some(*b"hin");
        let path = super::scratch_file("multi-audio", "mp4");
        mp4_writer::write_mp4(
            &path,
            vec![video_track(samples(60, 100, 3000, 30)), english, hindi],
            &options(),
            &AtomicBool::new(false),
        )
        .expect("writes");
        let bytes = std::fs::read(&path).expect("reads");
        let parsed = inspect_mp4_bytes(&bytes).expect("parses");
        assert_eq!(parsed.tracks.len(), 3);
        assert_eq!(parsed.tracks[0].handler, *b"vide");
        assert_eq!(parsed.tracks[1].handler, *b"soun");
        assert_eq!(parsed.tracks[2].handler, *b"soun");
        assert_eq!(parsed.tracks[1].sample_count, 87);
        assert_eq!(parsed.tracks[2].sample_count, 87);
        // "eng" and "hin", packed as three 5-bit letters.
        assert_eq!(parsed.tracks[1].language, 0x15C7);
        assert_eq!(parsed.tracks[2].language, 0x212E);
        assert_eq!(parsed.mdat_payload, 60 * 100 + 2 * 87 * 20);
        let expectation = super::validate::OutputExpectation {
            video: true,
            audio: true,
            duration_seconds: Some(2.0),
        };
        super::validate::validate_mp4(&path, expectation).expect("valid");
    }

    #[test]
    fn a_trimmed_pair_writes_a_clip_length_file() {
        // 3 s of 30 fps video and matching audio, clipped to [1 s, 2 s).
        let video_samples = samples(90, 10, 3000, 30);
        let video = clip::trim_samples(
            &video_samples,
            90_000,
            true,
            0,
            ClipRange::new(1000, 2000).unwrap(),
        )
        .expect("trims video");
        let audio_samples = samples(130, 4, 1024, 1);
        let audio = clip::trim_samples(
            &audio_samples,
            44_100,
            false,
            0,
            ClipRange::new(1000, 2000).unwrap(),
        )
        .expect("trims audio");
        let mut video_track = video_track(
            video
                .indices
                .iter()
                .map(|index| video_samples[*index])
                .collect(),
        );
        video_track.media_time = Some(video.media_time);
        let mut audio_track = audio_track(
            audio
                .indices
                .iter()
                .map(|index| audio_samples[*index])
                .collect(),
        );
        audio_track.media_time = Some(audio.media_time);
        let path = super::scratch_file("clip-pair", "mp4");
        mp4_writer::write_mp4(
            &path,
            vec![video_track, audio_track],
            &options(),
            &AtomicBool::new(false),
        )
        .expect("writes");
        let bytes = std::fs::read(&path).expect("reads");
        let parsed = inspect_mp4_bytes(&bytes).expect("parses");
        assert_eq!(parsed.tracks[0].sample_count, 30);
        assert_eq!(parsed.tracks[1].sample_count, 43);
        assert!((parsed.duration_seconds - 1.0).abs() < 0.05);
    }
}
