import { useShellPages } from "../../lib/useShellPages";

// Headless controller for what the app offers outside its windows: the Dock menu or Jump List, and icon progress.
export function ShellPagesController() {
  useShellPages();
  return null;
}
