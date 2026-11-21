import { invokeBackend } from "./errors";

export type DownloadStorageKind = "video" | "music";

export interface DownloadStorageRow {
  kind: DownloadStorageKind;
  bytes: number;
  files: number;
  /** Megabytes; 0 means no limit. */
  limitMb: number;
}

/** How much disk the saved downloads use, per type, with each type's limit. */
export function getDownloadStorageUsage(): Promise<DownloadStorageRow[]> {
  return invokeBackend<DownloadStorageRow[]>("download_storage_usage");
}
