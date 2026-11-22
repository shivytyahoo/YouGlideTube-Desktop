import type { StreamVariant } from "../types/video";

export interface QualityGroup {
  label: string;
  items: StreamVariant[];
}

/** Groups quality rows by resolution, in first-seen order, for the grouped quality selector. */
export function groupQualitiesByResolution(qualities: StreamVariant[]): QualityGroup[] {
  const groups: QualityGroup[] = [];
  for (const quality of qualities) {
    const label = quality.qualityLabel || "Auto";
    const existing = groups.find((group) => group.label === label);
    if (existing) existing.items.push(quality);
    else groups.push({ label, items: [quality] });
  }
  return groups;
}
