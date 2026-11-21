import { describe, expect, it } from "vitest";

import type { MasterBackup } from "./backup";
import { isProfilesMaster, restoreMasterProfiles } from "./masterRestore";

const backup = {
  schemaVersion: 2,
  scope: "MASTER",
  settings: { theme_id: "ocean" },
  collections: { watch_history: [{ v: "default" }] },
  manifest: { format: "flow-master", version: 1, defaultId: "backup-default", profiles: [], included: [] },
  profiles: {
    study: { settings: {}, collections: { watch_history: [{ v: "study" }] } },
    gaming: { settings: { theme_id: "neon" }, collections: {} },
  },
  profile_avatars: {},
} as unknown as MasterBackup;

describe("restoreMasterProfiles", () => {
  it("recognises only a master with a manifest", () => {
    expect(isProfilesMaster(backup)).toBe(true);
    expect(isProfilesMaster({ scope: "MASTER", settings: {} })).toBe(false);
  });

  it("hands back the Default part and counts the skipped profiles", () => {
    const { running, skippedProfiles } = restoreMasterProfiles(backup);
    expect(running?.settings).toEqual({ theme_id: "ocean" });
    expect(running?.collections).toEqual({ watch_history: [{ v: "default" }] });
    expect(skippedProfiles).toBe(2);
  });

  it("skips nothing when the backup holds only the Default part", () => {
    const single = { ...backup, profiles: {} } as unknown as MasterBackup;
    expect(restoreMasterProfiles(single).skippedProfiles).toBe(0);
  });
});
