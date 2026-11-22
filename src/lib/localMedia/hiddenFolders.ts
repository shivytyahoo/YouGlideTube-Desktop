/** The Settings "Hidden folders" list: one folder path per line, stored as JSON. */

/** Parse the textarea text into a de-duplicated list of folder paths. */
export function parseHiddenFolders(text: string): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const line of text.split("\n")) {
    const path = line.trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

/** Render the stored list back into textarea text, one path per line. */
export function hiddenFoldersText(paths: string[]): string {
  return paths.join("\n");
}

/** Which paths to exclude and which exclusions to lift to reach the wanted list. */
export function hiddenFoldersDiff(
  current: string[],
  wanted: string[],
): { toExclude: string[]; toRemove: string[] } {
  const wantedSet = new Set(wanted);
  const currentSet = new Set(current);
  return {
    toExclude: wanted.filter((path) => !currentSet.has(path)),
    toRemove: current.filter((path) => !wantedSet.has(path)),
  };
}

/** Parse the stored JSON setting value; corrupt values read as an empty list. */
export function parseStoredHiddenFolders(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
