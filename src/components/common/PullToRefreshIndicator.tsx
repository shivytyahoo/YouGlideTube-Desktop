import { RefreshCw } from "lucide-react";

/** The pull indicator: it grows with the drag, then spins until the refresh lands. */
export function PullToRefreshIndicator({ pullPx, refreshing }: { pullPx: number; refreshing: boolean }) {
  if (pullPx <= 0 && !refreshing) return null;
  return (
    <div
      aria-hidden="true"
      className="flex items-start justify-center overflow-hidden"
      style={{ height: refreshing ? 48 : pullPx }}
    >
      <RefreshCw
        size={18}
        className={`mt-3 ${refreshing ? "animate-spin text-chrome-neutral-300" : "text-chrome-neutral-400"}`}
        style={refreshing ? undefined : { transform: `rotate(${pullPx * 2.5}deg)` }}
      />
    </div>
  );
}
