import { describe, expect, it, vi } from "vitest";

import { EqChain } from "./eqChain";
import { EQ_GRAPH_OFF, type EqGraphSpec } from "./eq/graphPlan";

class FakeParam {
  value = 0;
  setTargetAtTime = vi.fn((v: number) => {
    this.value = v;
  });
}

interface Connection {
  from: string;
  to: string;
  output: number;
  input: number;
}

const connections: Connection[] = [];

class FakeNode {
  name: string;
  connect = vi.fn((node: FakeNode, output = 0, input = 0) => {
    connections.push({ from: this.name, to: node.name, output, input });
    return node;
  });
  disconnect = vi.fn();
  constructor(name: string) {
    this.name = name;
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
  channelCount = 2;
  channelCountMode: ChannelCountMode = "max";
}

class FakeContext {
  currentTime = 0;
  sampleRate = 48_000;
  nodes: Record<string, FakeNode[]> = {};
  private track<T extends FakeNode>(kind: string, node: T): T {
    (this.nodes[kind] ??= []).push(node);
    return node;
  }
  createGain() {
    return this.track("gain", new FakeGain(`gain${(this.nodes.gain?.length ?? 0) + 1}`));
  }
  createBiquadFilter() {
    const node = this.track(
      "filter",
      Object.assign(new FakeNode(`filter${(this.nodes.filter?.length ?? 0) + 1}`), {
        type: "peaking",
        frequency: new FakeParam(),
        Q: new FakeParam(),
        gain: new FakeParam(),
      }),
    );
    return node;
  }
  createWaveShaper() {
    return this.track("shaper", Object.assign(new FakeNode("clipper"), { curve: null as Float32Array | null }));
  }
  createChannelSplitter() {
    return this.track("splitter", new FakeNode("splitter"));
  }
  createChannelMerger() {
    return this.track("merger", new FakeNode("merger"));
  }
  createStereoPanner() {
    return this.track("panner", Object.assign(new FakeNode("panner"), { pan: new FakeParam() }));
  }
  createDynamicsCompressor() {
    return this.track(
      "compressor",
      Object.assign(new FakeNode("compressor"), {
        threshold: new FakeParam(),
        knee: new FakeParam(),
        ratio: new FakeParam(),
        attack: new FakeParam(),
        release: new FakeParam(),
      }),
    );
  }
}

const stereoSpec: EqGraphSpec = {
  ...EQ_GRAPH_OFF,
  enabled: true,
  balance: -0.5,
  width: 2,
  nightMode: true,
};

describe("EqChain stereo stage", () => {
  it("wires the mid/side matrix, panner and compressor after the clipper", () => {
    connections.length = 0;
    const ctx = new FakeContext();
    const chain = new EqChain(ctx as unknown as BaseAudioContext);
    // Gains are made in order: input, boost, clipIn, upmix, mid, side, invert, invertSide, makeup.
    const has = (from: string, to: string, output = 0, input = 0) =>
      connections.some((c) => c.from === from && c.to === to && c.output === output && c.input === input);
    // Mid takes both channels; side takes left and the inverted right.
    expect(has("splitter", "gain5", 0)).toBe(true);
    expect(has("splitter", "gain5", 1)).toBe(true);
    expect(has("splitter", "gain6", 0)).toBe(true);
    expect(has("splitter", "gain7", 1)).toBe(true);
    expect(has("gain7", "gain6")).toBe(true);
    // L = mid + side, R = mid − side (side inverted again into the right channel).
    expect(has("gain5", "merger", 0, 0)).toBe(true);
    expect(has("gain6", "merger", 0, 0)).toBe(true);
    expect(has("gain5", "merger", 0, 1)).toBe(true);
    expect(has("gain6", "gain8")).toBe(true);
    expect(has("gain8", "merger", 0, 1)).toBe(true);
    expect(has("merger", "panner")).toBe(true);
    expect(has("panner", "compressor")).toBe(true);
    expect(has("compressor", "gain9")).toBe(true);
    expect(chain.output).toBe(ctx.nodes.gain![ctx.nodes.gain!.length - 1]);
  });

  it("drives width, balance and night mode from the spec", () => {
    const ctx = new FakeContext();
    const chain = new EqChain(ctx as unknown as BaseAudioContext);
    chain.apply(stereoSpec);
    const gains = ctx.nodes.gain as FakeGain[];
    // input, boost, clipIn, upmix, mid, side, invert, invertSide, makeup
    const mid = gains[4]!;
    const side = gains[5]!;
    expect(mid.gain.value).toBe(0.5);
    expect(side.gain.value).toBe(1);
    const panner = ctx.nodes.panner![0] as FakeNode & { pan: FakeParam };
    expect(panner.pan.value).toBe(-0.5);
    const compressor = ctx.nodes.compressor![0] as FakeNode & {
      threshold: FakeParam;
      ratio: FakeParam;
    };
    expect(compressor.threshold.value).toBe(-24);
    expect(compressor.ratio.value).toBe(4);
    const makeup = gains[gains.length - 1]!;
    expect(makeup.gain.value).toBeCloseTo(Math.pow(10, 4 / 20), 9);
  });

  it("sits neutral when the equalizer is off", () => {
    const ctx = new FakeContext();
    const chain = new EqChain(ctx as unknown as BaseAudioContext);
    chain.apply(stereoSpec);
    chain.apply(EQ_GRAPH_OFF);
    const gains = ctx.nodes.gain as FakeGain[];
    expect(gains[4]!.gain.value).toBe(0.5);
    expect(gains[5]!.gain.value).toBe(0.5);
    const panner = ctx.nodes.panner![0] as FakeNode & { pan: FakeParam };
    expect(panner.pan.value).toBe(0);
    const compressor = ctx.nodes.compressor![0] as FakeNode & {
      threshold: FakeParam;
      ratio: FakeParam;
    };
    expect(compressor.threshold.value).toBe(0);
    expect(compressor.ratio.value).toBe(1);
    expect(gains[gains.length - 1]!.gain.value).toBe(1);
  });
});
