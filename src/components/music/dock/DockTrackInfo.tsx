import { getString } from "../../../lib/i18n/index";
import { useMusicPlayerStore } from "../../../store/useMusicPlayerStore";
import { MusicArtwork } from "../MusicArtwork";
import { MusicCardMenu } from "../MusicCardMenu";
import { PlayingWave } from "../PlayingWave";
import { CoverRing } from "./CoverRing";
import { MiniLyricsLine } from "./MiniLyricsLine";
import type { DockModel } from "./dockModel";

/**
 * The cover, title and artist that open the full player. The Pill draws a round cover with the song's
 * progress around it; Classic keeps its rounded square.
 */
export function DockTrackInfo({ model, round }: { model: DockModel; round: boolean }) {
  const openOverlay = useMusicPlayerStore((s) => s.openOverlay);
  const { shown, playing, busy, menu, menuActions, look } = model;
  const shape = round ? "rounded-full" : "rounded-xl";
  // The Pill's own options; Classic keeps its fixed look.
  const ring = round && look.coverRing;
  const coverPlays = round && look.coverTap === "play_pause";
  const sung = round && look.sungLine && model.track;
  return (
    <>
      <button
        type="button"
        onClick={() => openOverlay("full")}
        onContextMenu={menu.openMenuFromContext}
        aria-label={getString("music_expand")}
        className="group/art flex min-w-0 flex-1 items-center gap-3 rounded-md text-start outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
      >
        <div
          className={`relative shrink-0 ${round ? "h-12 w-12 p-1" : "h-12 w-12"}`}
          onClick={
            coverPlays
              ? (event) => {
                  event.stopPropagation();
                  useMusicPlayerStore.getState().togglePlay();
                }
              : undefined
          }
        >
          <MusicArtwork
            src={shown.thumbnail}
            alt={shown.title}
            loading={busy}
            className={`h-full w-full ${shape} ring-1 ring-chrome-neutral-800/60 transition-transform duration-200 ease-out group-hover/art:scale-[1.04]`}
          />
          {playing && !busy && (
            <span className={`pointer-events-none absolute grid place-items-center bg-chrome-black/35 text-chrome-white ${round ? "inset-1" : "inset-0"} ${shape}`}>
              <PlayingWave className={round ? "h-3.5" : "h-4"} />
            </span>
          )}
          {ring && <CoverRing />}
        </div>
        <div className="min-w-0 flex-1">
          <div dir="auto" className="line-clamp-1 text-[15px] font-semibold tracking-tight text-chrome-neutral-100">
            {shown.title}
          </div>
          {sung ? (
            <MiniLyricsLine track={sung} artist={shown.by} />
          ) : (
            <div className="mt-0.5 line-clamp-1 text-[13px] font-medium text-chrome-neutral-400">{shown.by}</div>
          )}
        </div>
      </button>
      <MusicCardMenu actions={menuActions} anchor={menu.anchor} onClose={menu.closeMenu} show={menu.showMenu} />
    </>
  );
}
