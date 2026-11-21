import { useDeepLinkHandoff } from "../../lib/useDeepLinkHandoff";

/**
 * Routes `youglidetube://` deep links and loopback-bridge handoffs (including the browser
 * extension) into playback or the download dialog. Renders nothing.
 */
export function DeepLinkController() {
  useDeepLinkHandoff();
  return null;
}
