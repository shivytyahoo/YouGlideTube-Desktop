export function isMusicVideo(v: {
  viewCountText?: string | null;
  channelName?: string | null;
}): boolean {
  const views = (v.viewCountText ?? "").toLowerCase();
  const channel = (v.channelName ?? "").toLowerCase();
  return views === "song" || views === "album track" || channel.includes("- topic");
}

export function formatCount(count: number | string | undefined | null): string {
  if (count === undefined || count === null) return "";

  let num: number;
  if (typeof count === "number") {
    num = count;
  } else {
    const cleanStr = count.replace(/,/g, "").trim();
    
    const shortMatch = cleanStr.match(/^([\d\.]+)\s*([kKmMbBtT])/);
    if (shortMatch && shortMatch[1] && shortMatch[2]) {
      return `${shortMatch[1]}${shortMatch[2].toUpperCase()}`;
    }

    const match = cleanStr.match(/^[\d\.]+/);
    if (!match || !match[0]) return count; 
    num = parseFloat(match[0]);
    if (isNaN(num)) return count;

    const remaining = cleanStr.slice(match[0].length).toLowerCase().trim();
    if (remaining.length > 0) {
      const firstChar = remaining.charAt(0);
      if (firstChar === "k" || firstChar === "m" || firstChar === "b" || firstChar === "t") {
        return `${match[0]}${firstChar.toUpperCase()}`;
      }
    }
  }

  if (num >= 1e9) {
    const formatted = (num / 1e9).toFixed(1);
    return (formatted.endsWith(".0") ? formatted.slice(0, -2) : formatted) + "B";
  }
  if (num >= 1e6) {
    const formatted = (num / 1e6).toFixed(1);
    return (formatted.endsWith(".0") ? formatted.slice(0, -2) : formatted) + "M";
  }
  if (num >= 1e3) {
    const formatted = (num / 1e3).toFixed(1);
    return (formatted.endsWith(".0") ? formatted.slice(0, -2) : formatted) + "K";
  }

  return num.toString();
}

/**
 * The inverse of {@link formatCount}: turns a displayed count like
 * "12,345", "1.2K", "1.2M" or "1.2B" back into a number, or `null` when the
 * text is not a count at all (e.g. a locale's words). Used to apply a
 * server-confirmed like delta to a server snapshot count.
 */
export function parseCountText(text: string | undefined | null): number | null {
  if (!text) return null;
  const clean = text.replace(/,/g, "").trim();
  const match = clean.match(/^([\d.]+)\s*([kKmMbBtT])?/);
  if (!match || !match[1]) return null;
  const value = parseFloat(match[1]);
  if (isNaN(value)) return null;
  const suffix = (match[2] ?? "").toLowerCase();
  const multiplier =
    suffix === "k" ? 1e3 : suffix === "m" ? 1e6 : suffix === "b" ? 1e9 : suffix === "t" ? 1e12 : 1;
  return Math.round(value * multiplier);
}

/**
 * An optimistic count flip, as Android's post like does: the count text is
 * the only visible counter, so it moves with the icon or a successful tap
 * looks like nothing happened. Compact counts round back to themselves
 * (2.2K + 1 still reads 2.2K), same as YouTube. The text comes back
 * unchanged when it is not a count at all.
 */
export function adjustCountText(text: string | undefined | null, delta: number): string | null {
  const parsed = parseCountText(text);
  if (parsed === null) return text ?? null;
  return formatCount(Math.max(0, parsed + delta));
}
