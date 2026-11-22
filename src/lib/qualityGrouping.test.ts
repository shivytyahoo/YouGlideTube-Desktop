import { describe, expect, it } from "vitest";

import { groupQualitiesByResolution } from "./qualityGrouping";
import type { StreamVariant } from "../types/video";

const variant = (id: string, label: string): StreamVariant => ({
  id,
  qualityLabel: label,
  quality: label,
} as unknown as StreamVariant);

describe("groupQualitiesByResolution", () => {
  it("groups rows by resolution in first-seen order", () => {
    const groups = groupQualitiesByResolution([
      variant("a", "1080p"),
      variant("b", "720p"),
      variant("c", "1080p"),
    ]);
    expect(groups.map((group) => group.label)).toEqual(["1080p", "720p"]);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(["a", "c"]);
  });

  it("keeps a single group when every row shares a resolution", () => {
    expect(groupQualitiesByResolution([variant("a", "720p")])).toHaveLength(1);
  });
});
