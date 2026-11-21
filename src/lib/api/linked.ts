import { invokeBackend } from "./errors";

/**
 * The linked-device list, kept only for Play on: it names the devices
 * playback can move to. The group, WebDAV and recovery API that used to
 * live here is gone with the P2P sync system.
 */

export interface LinkedDevice {
  id: string;
  name: string;
  platform: string;
  thisDevice: boolean;
  /** It set the current recovery key, so its leaving stops the others writing. */
  setRecoveryKey: boolean;
  /** Met on this network in the last few minutes. */
  nearby: boolean;
  /** When the device last synced, as the server saw it, or as this device last met it on the LAN. */
  lastSyncMs?: number | null;
}

export const getLinkedDevices = () => invokeBackend<LinkedDevice[]>("linked_devices");
