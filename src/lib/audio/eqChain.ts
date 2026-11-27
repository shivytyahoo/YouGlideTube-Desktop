import { EQ_FILTER_POOL, EQ_GRAPH_OFF, filterSetting, type EqGraphSpec } from "./eq/graphPlan";
import { EqLimits } from "./eq/models";
import { dbToGain, midSideGains, nightCompressor } from "./eq/spatial";
import { SOFT_CLIP_HEADROOM, softClipCurve } from "./softClip";

/** Time constant every parameter glides with: quick enough to feel instant, slow enough not to click. */
export const RAMP_TIME_CONSTANT = 0.012;

let sharedClipCurve: Float32Array<ArrayBuffer> | null = null;

/**
 * One player's equalizer: preamp, a fixed pool of filters, a bass boost shelf, a soft clipper,
 * then the stereo stage — a mid/side matrix for width, a panner for balance, a compressor for
 * night mode. Nodes are made once; a new curve only moves their parameters, so the sound glides
 * from one setting to the next and nothing is ever reconnected while audio plays.
 */
export class EqChain {
  readonly input: GainNode;
  readonly output: AudioNode;
  private readonly filters: BiquadFilterNode[];
  private readonly bass: BiquadFilterNode;
  private readonly boost: GainNode;
  private readonly mid: GainNode;
  private readonly side: GainNode;
  private readonly panner: StereoPannerNode;
  private readonly compressor: DynamicsCompressorNode;
  private readonly makeup: GainNode;

  constructor(private readonly ctx: BaseAudioContext) {
    this.input = ctx.createGain();
    this.filters = Array.from({ length: EQ_FILTER_POOL }, () => {
      const f = ctx.createBiquadFilter();
      f.type = "peaking";
      f.gain.value = 0;
      return f;
    });
    this.bass = ctx.createBiquadFilter();
    this.bass.type = "lowshelf";
    this.bass.frequency.value = EqLimits.BASS_BOOST_FREQUENCY;
    this.bass.gain.value = 0;
    this.boost = ctx.createGain();

    // A WaveShaperNode clamps its input to ±1, so the signal goes in scaled down and the curve
    // spans the headroom; below the knee the curve is the identity, so normal levels pass as-is.
    const clipIn = ctx.createGain();
    clipIn.gain.value = 1 / SOFT_CLIP_HEADROOM;
    const clipper = ctx.createWaveShaper();
    sharedClipCurve ??= softClipCurve();
    clipper.curve = sharedClipCurve;

    let previous: AudioNode = this.input;
    for (const node of [...this.filters, this.bass, this.boost, clipIn, clipper]) {
      previous.connect(node);
      previous = node;
    }

    // Width is a mid/side matrix: mid = (L+R)/2, side = (L−R)/2, rebuilt as L = mid + side and
    // R = mid − side. A mono source must reach the splitter as stereo, or the matrix would drop
    // its right channel: an explicit two-channel gain duplicates mono and passes stereo through.
    const upmix = ctx.createGain();
    upmix.channelCount = 2;
    upmix.channelCountMode = "explicit";
    const splitter = ctx.createChannelSplitter(2);
    this.mid = ctx.createGain();
    this.side = ctx.createGain();
    const invert = ctx.createGain();
    invert.gain.value = -1;
    const invertSide = ctx.createGain();
    invertSide.gain.value = -1;
    const merger = ctx.createChannelMerger(2);
    this.panner = ctx.createStereoPanner();
    this.compressor = ctx.createDynamicsCompressor();
    this.makeup = ctx.createGain();

    clipper.connect(upmix);
    upmix.connect(splitter);
    splitter.connect(this.mid, 0);
    splitter.connect(this.mid, 1);
    splitter.connect(this.side, 0);
    splitter.connect(invert, 1);
    invert.connect(this.side);
    this.mid.connect(merger, 0, 0);
    this.side.connect(merger, 0, 0);
    this.mid.connect(merger, 0, 1);
    this.side.connect(invertSide);
    invertSide.connect(merger, 0, 1);
    merger.connect(this.panner);
    this.panner.connect(this.compressor);
    this.compressor.connect(this.makeup);
    this.output = this.makeup;

    // The stereo stage starts neutral: identity matrix, centred, no compression.
    this.mid.gain.value = 0.5;
    this.side.gain.value = 0.5;
    this.compressor.threshold.value = 0;
    this.compressor.ratio.value = 1;
  }

  /** Gain above full volume. It sits before the soft clipper, which catches what it pushes too far. */
  setBoost(gain: number): void {
    this.boost.gain.setTargetAtTime(gain, this.ctx.currentTime, RAMP_TIME_CONSTANT);
  }

  apply(spec: EqGraphSpec = EQ_GRAPH_OFF): void {
    const t = this.ctx.currentTime;
    const glide = (param: AudioParam, value: number) => param.setTargetAtTime(value, t, RAMP_TIME_CONSTANT);
    const sampleRate = this.ctx.sampleRate;

    this.filters.forEach((filter, i) => {
      const setting = spec.enabled ? filterSetting(spec.bands[i], sampleRate) : null;
      if (!setting) {
        // Peaks and shelves go flat at 0 dB whatever their frequency, so only the gain moves; a
        // low or high pass cannot be flattened and becomes a flat peak.
        if (filter.type === "lowpass" || filter.type === "highpass") filter.type = "peaking";
        glide(filter.gain, 0);
        return;
      }
      if (filter.type !== setting.type) filter.type = setting.type;
      glide(filter.frequency, setting.frequency);
      glide(filter.Q, setting.q);
      glide(filter.gain, setting.gain);
    });
    glide(this.bass.gain, spec.enabled ? spec.bassBoostDb : 0);
    glide(this.input.gain, spec.enabled ? Math.pow(10, spec.preampDb / 20) : 1);

    // The stereo stage only runs while the equalizer is on; off, it sits neutral.
    const { mid, side } = midSideGains(spec.enabled ? spec.width : 1);
    glide(this.mid.gain, mid);
    glide(this.side.gain, side);
    glide(this.panner.pan, spec.enabled ? spec.balance : 0);
    const night = nightCompressor(spec.enabled && spec.nightMode);
    glide(this.compressor.threshold, night.thresholdDb);
    glide(this.compressor.knee, night.kneeDb);
    glide(this.compressor.ratio, night.ratio);
    glide(this.compressor.attack, night.attackSeconds);
    glide(this.compressor.release, night.releaseSeconds);
    glide(this.makeup.gain, dbToGain(night.makeupGainDb));
  }
}
