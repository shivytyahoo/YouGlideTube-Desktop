import { describe, expect, it } from "vitest";
import type { RelatedContentItem } from "../types/video";
import { appendRelated, autoplayCandidates } from "./relatedLane";

// Labels become real 11-character video ids: autoplay only ever offers real
// videos, so the fixtures must be shaped like them.
const vid = (label: string) => `${label}0000000000`.slice(0, 11);
const video = (label: string): RelatedContentItem => {
  const id = vid(label);
  return {
    id,
    itemType: "video",
    title: `Video ${id}`,
    channelName: "Glide",
    videoId: id,
    playlistId: null,
    isMix: false,
  };
};

describe("appendRelated", () => {
  it("adds only the items not already listed", () => {
    expect(appendRelated([video("a"), video("b")], [video("b"), video("c")]).map((item) => item.id)).toEqual([
      vid("a"),
      vid("b"),
      vid("c"),
    ]);
  });
});

describe("autoplayCandidates", () => {
  it("moves YouTube's own pick to the front", () => {
    expect(autoplayCandidates([video("a"), video("b"), video("c")], vid("c")).map((item) => item.id)).toEqual([
      vid("c"),
      vid("a"),
      vid("b"),
    ]);
  });

  it("keeps the related order when the pick is not among them", () => {
    expect(autoplayCandidates([video("a"), video("b")], vid("z")).map((item) => item.id)).toEqual([
      vid("a"),
      vid("b"),
    ]);
  });

  it("falls back to the pick alone when no related video is left", () => {
    expect(autoplayCandidates([], vid("z"))).toEqual([{ id: vid("z"), title: "", channelName: "" }]);
    expect(autoplayCandidates([], null)).toEqual([]);
  });

  it("never offers a playlist or mix to autoplay", () => {
    const mix: RelatedContentItem = { ...video("m"), itemType: "mix", isMix: true, playlistId: "RDm" };
    expect(autoplayCandidates([mix, video("a")], null).map((item) => item.id)).toEqual([vid("a")]);
  });

  it("never offers the video playing as its own autoplay", () => {
    expect(autoplayCandidates([video("a"), video("b")], null, vid("a")).map((item) => item.id)).toEqual([
      vid("b"),
    ]);
    expect(autoplayCandidates([video("a")], vid("a"), vid("a"))).toEqual([
      { id: vid("a"), title: "", channelName: "" },
    ]);
  });

  it("never offers a promo card's id to autoplay", () => {
    const promo: RelatedContentItem = {
      ...video("a"),
      id: "sb-acq-c-projectemu-wn-NNDb",
      videoId: "sb-acq-c-projectemu-wn-NNDb",
      title: "Try YouTube Premium free",
    };
    expect(autoplayCandidates([promo, video("b")], null).map((item) => item.id)).toEqual([vid("b")]);
    expect(autoplayCandidates([promo], null)).toEqual([]);
  });
});
