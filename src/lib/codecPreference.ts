// H.264 decodes everywhere (including Linux WebKitGTK with only gst-libav);
// VP9/AV1 depend on optional GStreamer plugins, so they rank as a bonus.
export function codecRank(mime?: string | null): number {
  const value = mime?.toLowerCase() ?? "";
  if (value.includes("avc1") || value.includes("avc3") || value.includes("h264")) return 0;
  if (value.includes("vp9") || value.includes("vp09")) return 1;
  if (value.includes("av01")) return 2;
  return 3;
}

export const VIDEO_CODECS = ["H.264", "VP9", "AV1"] as const;

/**
 * The codec to try when the preferred one cannot play a video: the user's
 * fallback choice, unless it is Auto or the same as the preferred codec, in
 * which case the first other codec in decode order. Never the preferred codec.
 */
export function effectiveFallbackCodec(preferred: string, fallback: string): string {
  const usable = fallback !== "Auto" && fallback !== preferred && (VIDEO_CODECS as readonly string[]).includes(fallback);
  if (usable) return fallback;
  return VIDEO_CODECS.find((codec) => codec !== preferred) ?? "H.264";
}
