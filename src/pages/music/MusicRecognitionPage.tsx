import { useNavigate } from "react-router-dom";
import { AudioLines, Loader2, Mic, Play, Search, X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { getString } from "../../lib/i18n/index";
import {
  recognitionResultToSong,
  searchQueryFor,
  type RecognitionResult,
} from "../../lib/recognition";
import { useMusicRecognition } from "../../lib/useMusicRecognition";
import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";

/**
 * Shazam-style music recognition, as Android's `RecognitionScreen` runs it:
 * a mic button that listens for 12s, then a result card with Play (when the
 * match carries a YouTube id) and Search — the search opens music search
 * with the recognised song as the query. No-match and errors offer a retry.
 */
export default function MusicRecognitionPage() {
  const navigate = useNavigate();
  const recognition = useMusicRecognition();
  const playQueue = useMusicPlayerStore((s) => s.playQueue);
  const status = recognition.status;

  const playResult = (result: RecognitionResult) => {
    const song = recognitionResultToSong(result);
    if (!song) return;
    void playQueue([song], 0, "Recognized");
  };

  const searchResult = (result: RecognitionResult) => {
    navigate(
      `/music/search?q=${encodeURIComponent(searchQueryFor(result.title, result.artist))}`,
    );
  };

  return (
    <div className="flex grow items-center justify-center overflow-y-auto">
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-8 py-20 text-center">
        <AudioLines className="h-12 w-12 text-chrome-neutral-500" />
        <h1 className="text-2xl font-bold tracking-tight text-chrome-neutral-100">
          {getString("music_recognition_title")}
        </h1>

        {status.state === "idle" && (
          <>
            <p className="text-sm leading-relaxed text-chrome-neutral-400">
              {getString("music_recognition_body")}
            </p>
            <button
              type="button"
              onClick={recognition.start}
              aria-label={getString("music_recognition_tap_to_listen")}
              className="flex h-20 w-20 items-center justify-center rounded-full bg-surface-container text-chrome-accent transition hover:bg-surface-container-high"
            >
              <Mic className="h-9 w-9" />
            </button>
            <p className="text-sm text-chrome-neutral-400">
              {getString("music_recognition_tap_to_listen")}
            </p>
            <Button variant="secondary" onClick={() => navigate("/music/search")}>
              {getString("music_recognition_search_instead")}
            </Button>
          </>
        )}

        {status.state === "listening" && (
          <>
            <p className="text-sm leading-relaxed text-chrome-neutral-400">
              {getString("music_recognition_listening")}
            </p>
            <button
              type="button"
              onClick={recognition.cancel}
              aria-label={getString("music_recognition_cancel")}
              className="flex h-20 w-20 animate-pulse items-center justify-center rounded-full bg-surface-container text-chrome-accent"
            >
              <Mic className="h-9 w-9" />
            </button>
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container"
              role="progressbar"
              aria-valuenow={Math.round(status.progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-chrome-accent"
                style={{ width: `${Math.round(status.progress * 100)}%` }}
              />
            </div>
            <Button variant="secondary" onClick={recognition.cancel}>
              {getString("music_recognition_cancel")}
            </Button>
          </>
        )}

        {status.state === "processing" && (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-chrome-neutral-500" />
            <p className="text-sm text-chrome-neutral-400">
              {getString("music_recognition_processing")}
            </p>
          </>
        )}

        {status.state === "success" && (
          <RecognitionResultCard
            result={status.result}
            onPlay={() => playResult(status.result)}
            onSearch={() => searchResult(status.result)}
            onTryAgain={recognition.reset}
          />
        )}

        {(status.state === "noMatch" || status.state === "error") && (
          <>
            <p className="text-sm leading-relaxed text-chrome-neutral-400">
              {getString(status.messageKey)}
            </p>
            <div className="flex gap-2">
              <Button onClick={recognition.reset}>
                {getString("music_recognition_try_again")}
              </Button>
              <Button variant="secondary" onClick={() => navigate("/music/search")}>
                {getString("music_recognition_search_instead")}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RecognitionResultCard({
  result,
  onPlay,
  onSearch,
  onTryAgain,
}: {
  result: RecognitionResult;
  onPlay: () => void;
  onSearch: () => void;
  onTryAgain: () => void;
}) {
  const cover = result.coverArtHqUrl ?? result.coverArtUrl;
  const details = [result.genre, result.releaseDate]
    .filter((part) => part)
    .join(" · ");
  return (
    <div className="flex w-full flex-col items-center gap-3 rounded-2xl bg-surface-container p-6">
      {cover && (
        <img
          src={cover}
          alt=""
          className="h-40 w-40 rounded-xl object-cover"
        />
      )}
      <div>
        <p className="text-lg font-semibold text-chrome-neutral-100">{result.title}</p>
        <p className="text-sm text-chrome-neutral-400">{result.artist}</p>
        {result.album && (
          <p className="text-sm text-chrome-neutral-400">{result.album}</p>
        )}
        {details && (
          <p className="text-xs text-chrome-neutral-500">{details}</p>
        )}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {result.youtubeVideoId && (
          <Button onClick={onPlay}>
            <Play className="h-4 w-4" />
            {getString("music_recognition_play")}
          </Button>
        )}
        <Button variant="secondary" onClick={onSearch}>
          <Search className="h-4 w-4" />
          {getString("music_recognition_search")}
        </Button>
        <Button variant="ghost" onClick={onTryAgain}>
          <X className="h-4 w-4" />
          {getString("music_recognition_try_again")}
        </Button>
      </div>
    </div>
  );
}
