import type { BackupCollections, MasterBackup, ProfileBackupSlice } from "./backup";

/** A master backup from a build with profiles (it carries Android's manifest). */
export function isProfilesMaster(value: unknown): value is MasterBackup {
  const manifest = (value as { manifest?: { format?: unknown } } | null)?.manifest;
  return manifest?.format === "youglidetube-master" || manifest?.format === "flow-master";
}

/**
 * Splits a profiles-era master backup: the library is the backup's Default part, which
 * lives at the top level; every other profile's part is skipped — there is only one
 * library now. Returns the Default part, which the normal import restores live, and
 * how many other profiles were skipped.
 */
export function restoreMasterProfiles(
  backup: MasterBackup,
): { running: ProfileBackupSlice | null; skippedProfiles: number } {
  const running: ProfileBackupSlice = {
    settings: backup.settings,
    collections: backup.collections ?? ({} as BackupCollections),
  };
  const skippedProfiles = Object.keys(backup.profiles ?? {}).filter(
    (id) => id !== backup.manifest.defaultId,
  ).length;
  return { running, skippedProfiles };
}
