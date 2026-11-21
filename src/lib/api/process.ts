import { invokeBackend } from "./errors";
import { isTauriEnv } from "./env";

/** Quits the app, as the sleep timer's "Quit YouGlideTube when it ends" asks. */
export async function quitApp(): Promise<void> {
  if (!(await isTauriEnv())) return;
  const { exit } = await import("@tauri-apps/plugin-process");
  await exit(0);
}

/** Restarts the app without re-running the command line it was opened with. */
export async function relaunchYouGlideTube(): Promise<void> {
  if (!(await isTauriEnv())) return;
  await invokeBackend<void>("relaunch_app");
}
