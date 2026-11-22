/**
 * How a reel's chrome is drawn for one Shorts player UI mode, mirroring
 * Android's ShortsOverlayStyle. Components read these facts, never the mode,
 * so a fourth mode is a new row here and nothing else.
 */
export type ShortsUiMode = "default" | "simple" | "impressive";

export type ShortsSubscribeControl = "button" | "icon";

export interface ShortsOverlayStyle {
  /** Rail buttons carry a label, and a missing count falls back to the action's name. */
  showRailLabels: boolean;
  subscribeControl: ShortsSubscribeControl;
  /** Chrome stays hidden until a centre tap and hides again on its own. */
  controlsOnDemand: boolean;
  /** Saving confirms with a toast, because the rail has no label to change. */
  toastOnSave: boolean;
}

export function parseShortsUiMode(raw: string | undefined | null): ShortsUiMode {
  return raw === "simple" || raw === "impressive" ? raw : "default";
}

export function shortsOverlayStyle(mode: ShortsUiMode): ShortsOverlayStyle {
  switch (mode) {
    case "simple":
      return {
        showRailLabels: false,
        subscribeControl: "icon",
        controlsOnDemand: false,
        toastOnSave: true,
      };
    case "impressive":
      return {
        showRailLabels: true,
        subscribeControl: "button",
        controlsOnDemand: true,
        toastOnSave: false,
      };
    case "default":
    default:
      return {
        showRailLabels: true,
        subscribeControl: "button",
        controlsOnDemand: false,
        toastOnSave: false,
      };
  }
}
