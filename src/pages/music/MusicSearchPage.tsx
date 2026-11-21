import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, AudioLines, Loader2, Mic, SearchX, X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { IconButton } from "../../components/ui/IconButton";
import { SearchInput } from "../../components/ui/SearchInput";
import { CategoryChips } from "../../components/layout/CategoryChips";
import { MusicItemCard } from "../../components/music/MusicItemCard";
import { getString } from "../../lib/i18n/index";
import { MUSIC_SEARCH_FILTERS, useMusicSearch, type MusicSearchFilter } from "../../lib/useMusicSearch";
import { useMusicMoods } from "../../lib/useMusicMoods";
import { startVoiceSearch, type VoiceSearchHandle } from "../../lib/voiceSearch";
import { musicSeeAllRoute } from "../../lib/musicRoutes";
import { episodeAsSong } from "../../lib/searchResults";
import { useUiStore } from "../../store/useUiStore";
import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { useGridStyle } from "../../lib/useGridColumns";
import type { SongItem, YTItem } from "../../types/music";

/**
 * The dedicated music search, as Android's `MusicSearchScreen` runs it: a
 * bar with back, field, clear, voice and recognition entries; history,
 * suggestions and moods while idle; the four filter chips over summary
 * sections once a query runs, and a flat filtered list under a chip.
 */
export default function MusicSearchPage() {
  const [searchParams] = useSearchParams();
  const initialQuery = searchParams.get("q") ?? undefined;
  const navigate = useNavigate();
  const search = useMusicSearch(initialQuery);
  const moods = useMusicMoods();
  const playQueue = useMusicPlayerStore((s) => s.playQueue);
  const showToast = useUiStore((s) => s.showToast);
  const gridStyle = useGridStyle({ density: "dense", gapRem: 1.5 });
  const [listening, setListening] = useState(false);
  const voiceRef = useRef<VoiceSearchHandle | null>(null);

  useEffect(() => () => voiceRef.current?.stop(), []);

  const chipLabels = MUSIC_SEARCH_FILTERS.map((filter) => getString(filter.labelKey));
  const activeChip = search.activeFilter
    ? getString(MUSIC_SEARCH_FILTERS.find((f) => f.id === search.activeFilter)!.labelKey)
    : null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (search.draft.trim()) search.performSearch(search.draft);
  };

  const handleVoiceSearch = () => {
    const handle = startVoiceSearch({
      onTranscript: (spoken) => search.performSearch(spoken),
      onError: () => showToast({ variant: "error", message: getString("music_search_voice_unavailable") }),
      onEnd: () => {
        setListening(false);
        voiceRef.current = null;
      },
    });
    if (!handle) {
      showToast({ variant: "error", message: getString("music_search_voice_unavailable") });
      return;
    }
    voiceRef.current = handle;
    setListening(true);
  };

  const playSong = (track: SongItem, source: string | null) => {
    // A song from search plays alone, as YouTube Music does: the service
    // seeds its radio from it, so Up Next fills with related songs.
    void playQueue([track], 0, source);
  };

  const renderItem = (item: YTItem, source: string | null) => {
    switch (item.type) {
      case "song":
        return (
          <MusicItemCard
            key={item.videoId ?? item.id}
            variant="song"
            item={item}
            fill
            onPlay={() => playSong(item, source)}
          />
        );
      case "episode": {
        const asSong = episodeAsSong(item);
        return (
          <MusicItemCard
            key={item.id}
            variant="episode"
            item={item}
            fill
            onPlay={() => playSong(asSong, source)}
            onOpen={() => playSong(asSong, source)}
          />
        );
      }
      case "album":
        return (
          <MusicItemCard
            key={item.browseId}
            variant="album"
            item={item}
            fill
            onPlay={() => navigate(`/music/album/${item.browseId}`)}
            onOpen={() => navigate(`/music/album/${item.browseId}`)}
          />
        );
      case "playlist":
        return (
          <MusicItemCard
            key={item.id}
            variant="playlist"
            item={item}
            fill
            onPlay={() => navigate(`/music/playlist/${item.id}`)}
            onOpen={() => navigate(`/music/playlist/${item.id}`)}
          />
        );
      case "podcast":
        return (
          <MusicItemCard
            key={item.id}
            variant="podcast"
            item={item}
            fill
            onPlay={() => navigate(`/music/playlist/${item.id}`)}
            onOpen={() => navigate(`/music/playlist/${item.id}`)}
          />
        );
      case "artist":
        return (
          <MusicItemCard
            key={item.id}
            variant="artist"
            item={item}
            fill
            onOpen={() => navigate(`/music/artist/${item.id}`)}
          />
        );
      default:
        return null;
    }
  };

  const onChipChange = (label: string) => {
    const filter = MUSIC_SEARCH_FILTERS.find((f) => getString(f.labelKey) === label);
    if (filter) search.applyFilter(filter.id as MusicSearchFilter);
  };

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!search.continuation || search.loadingMore) return;
    const target = sentinelRef.current;
    if (!target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void search.loadMore();
      },
      { rootMargin: "0px 0px 800px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [search]);

  return (
    <div className="grow overflow-y-auto">
      <div className="mx-auto w-full max-w-400 px-8 pb-20">
        <form
          onSubmit={submit}
          className="sticky top-0 z-10 -mx-8 flex items-center gap-2 bg-chrome-neutral-950/95 px-8 py-4 backdrop-blur"
        >
          <IconButton onClick={() => navigate("/music")} aria-label={getString("back")}>
            <ArrowLeft size={20} />
          </IconButton>
          <SearchInput
            value={search.draft}
            onChange={(event) => search.setDraft(event.target.value)}
            placeholder={getString("music_search_placeholder")}
            containerClassName="min-w-0 flex-1"
            autoComplete="off"
            autoFocus={!initialQuery}
          />
          {search.draft && (
            <IconButton onClick={search.clearSearch} aria-label={getString("clear")}>
              <X size={18} />
            </IconButton>
          )}
          <IconButton
            onClick={handleVoiceSearch}
            aria-label={getString("music_search_voice_search")}
            disabled={listening}
          >
            <Mic size={20} className={listening ? "text-chrome-accent" : undefined} />
          </IconButton>
          <IconButton
            onClick={() => navigate("/music/recognition")}
            aria-label={getString("music_search_recognition")}
          >
            <AudioLines size={20} />
          </IconButton>
        </form>

        {!search.isSearching ? (
          <div className="space-y-8 pt-2">
            {search.matchingHistory.length > 0 && (
              <section>
                <h2 className="mb-3 text-lg font-semibold text-chrome-neutral-100">
                  {getString("music_search_history_title")}
                </h2>
                <ul className="space-y-1">
                  {search.matchingHistory.map((entry) => (
                    <li key={entry.query}>
                      <button
                        type="button"
                        className="w-full rounded-lg px-3 py-2 text-start text-sm text-chrome-neutral-200 hover:bg-surface-container"
                        onClick={() => search.performSearch(entry.query)}
                      >
                        {entry.query}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {search.suggestions.length > 0 && (
              <section>
                <ul className="space-y-1">
                  {search.suggestions.map((suggestion) => (
                    <li key={suggestion}>
                      <button
                        type="button"
                        className="w-full rounded-lg px-3 py-2 text-start text-sm text-chrome-neutral-200 hover:bg-surface-container"
                        onClick={() => search.performSearch(suggestion)}
                      >
                        {suggestion}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {search.recommendedItems.length > 0 && (
              <section>
                <div className="video-grid gap-y-6" style={gridStyle}>
                  {search.recommendedItems.map((item) => renderItem(item, null))}
                </div>
              </section>
            )}
            {moods.groups.length > 0 && (
              <section>
                <h2 className="mb-3 text-lg font-semibold text-chrome-neutral-100">
                  {getString("music_moods_and_genres")}
                </h2>
                <div className="flex flex-wrap gap-2">
                  {moods.groups.flatMap((group) => group.items).map((mood) => (
                    <Button
                      key={mood.browseId}
                      variant="secondary"
                      onClick={() => navigate(musicSeeAllRoute(mood.browseId, mood.params, mood.title))}
                    >
                      {mood.title}
                    </Button>
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : (
          <div className="space-y-8 pt-2">
            <CategoryChips
              categories={chipLabels}
              activeCategory={activeChip ?? ""}
              onCategoryChange={onChipChange}
              sticky={false}
              className="py-0"
            />
            {search.loading && search.summaries.length === 0 && search.filtered.length === 0 ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-chrome-neutral-500" />
              </div>
            ) : search.error && !search.hasResults ? (
              <div className="flex flex-col items-center gap-3 py-20 text-center">
                <p className="text-sm text-chrome-neutral-400">{search.error}</p>
                <Button variant="secondary" onClick={() => search.performSearch(search.query)}>
                  {getString("music_retry")}
                </Button>
              </div>
            ) : !search.hasResults ? (
              <div className="flex flex-col items-center gap-3 py-20 text-center">
                <SearchX className="h-8 w-8 text-chrome-neutral-500" />
                <p className="text-sm text-chrome-neutral-400">
                  {getString("music_search_no_results", search.query)}
                </p>
              </div>
            ) : search.activeFilter ? (
              <>
                <div className="video-grid gap-y-6" style={gridStyle}>
                  {search.filtered.map((item) => renderItem(item, getString("music_search_source_template", search.query)))}
                </div>
                <div ref={sentinelRef} />
                {search.loadingMore && (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-6 w-6 animate-spin text-chrome-neutral-500" />
                  </div>
                )}
              </>
            ) : (
              search.summaries
                .filter((section) => section.items.length > 0)
                .map((section) => (
                  <section key={section.title || "top"}>
                    <h2 className="mb-4 text-lg font-semibold text-chrome-neutral-100">
                      {section.title}
                    </h2>
                    <div className="video-grid gap-y-6" style={gridStyle}>
                      {section.items.map((item) =>
                        renderItem(item, getString("music_search_source_template", search.query)),
                      )}
                    </div>
                  </section>
                ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
