// Web storage is one store for the whole install: there is a single library now, so keys
// are stored bare. Keys left over from removed profiles (`p:<id>:...`) stay on disk,
// unread, where they can do no harm.
//
// Storage keys were renamed from the `flow_*` stems this app used to write.
// Reads of a `youglidetube_*` key fall back to its old `flow_*` twin so an
// existing install keeps its data; a legacy hit migrates forward (the new key
// is written and the old one removed). New code always uses the new name.
function legacyTwin(key: string): string | null {
  return key.startsWith("youglidetube_") ? `flow_${key.slice("youglidetube_".length)}` : null;
}

// Same throwing behaviour as localStorage, so callers keep their own error handling.
export const profileStorage = {
  getItem(key: string): string | null {
    const value = window.localStorage.getItem(key);
    if (value !== null) return value;
    const legacy = legacyTwin(key);
    if (legacy === null) return null;
    const legacyValue = window.localStorage.getItem(legacy);
    if (legacyValue === null) return null;
    window.localStorage.setItem(key, legacyValue);
    window.localStorage.removeItem(legacy);
    return legacyValue;
  },
  setItem(key: string, value: string): void {
    window.localStorage.setItem(key, value);
    const legacy = legacyTwin(key);
    if (legacy !== null) window.localStorage.removeItem(legacy);
  },
  removeItem(key: string): void {
    window.localStorage.removeItem(key);
    const legacy = legacyTwin(key);
    if (legacy !== null) window.localStorage.removeItem(legacy);
  },
  /** This install's keys; leftovers from removed profiles stay hidden. */
  keys(): string[] {
    return Object.keys(window.localStorage).filter((key) => !key.startsWith("p:"));
  },
};

// Session storage dies with the process.
export const sessionStore = {
  getItem(key: string): string | null {
    return window.sessionStorage.getItem(key);
  },
  setItem(key: string, value: string): void {
    window.sessionStorage.setItem(key, value);
  },
};
