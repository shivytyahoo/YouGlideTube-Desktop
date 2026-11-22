import { getString } from "../lib/i18n/index";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { closestCenter, DndContext, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { LayoutGrid, List, ListVideo, Loader2, Plus } from "lucide-react";
import type { PlaylistSummary, VideoSummary } from "../types/video";
import { Button } from "../components/ui/Button";
import { SearchInput } from "../components/ui/SearchInput";
import { CategoryChips } from "../components/layout/CategoryChips";
import { PlaylistCard } from "../components/video/PlaylistCard";
import { Select } from "../components/ui/Select";
import { OpenPlaylistFileButton } from "../components/playlist/OpenPlaylistFileButton";
import { PlaylistFormDialog } from "../components/playlist/PlaylistFormDialog";
import { getAccountSignedIn } from "../lib/api/account";
import { confirmPlaylistRemoval } from "../lib/confirmPlaylistRemoval";
import { useGridStyle } from "../lib/useGridColumns";
import { resolveDragMove, sortableRowStyle, useListDragSensors } from "../lib/sortableList";
import {
  loadPlaylistCustomOrder,
  loadPlaylistListOrder,
  loadPlaylistsCompact,
  PLAYLIST_LIST_ORDERS,
  playlistListOrderLabel,
  savePlaylistCustomOrder,
  savePlaylistListOrder,
  savePlaylistsCompact,
  sortStoredPlaylists,
  type PlaylistListOrder,
} from "../lib/playlistListOrder";
import {
  createStoredPlaylist,
  loadStoredPlaylists,
  PLAYLIST_LIBRARY_UPDATED_EVENT,
  removePlaylistFromLibrary,
  savePlaylistToLibrary,
  storedPlaylistToCardSummary,
  type StoredPlaylist,
} from "../lib/playlistLibrary";
import { isSystemServerPlaylistId, useServerPlaylistsStore } from "../store/useServerPlaylistsStore";
import { useUiStore } from "../store/useUiStore";

interface PlaylistsProps {
  onPlay: (track: VideoSummary) => void;
}

type PlaylistFilter = "All" | "Owned" | "Saved";
type LocalPlaylist = StoredPlaylist;

const FILTERS: PlaylistFilter[] = ["All", "Owned", "Saved"];

function DraggablePlaylist({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={sortableRowStyle(transform, transition)}
      className={`cursor-grab rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${isDragging ? "opacity-80" : ""}`}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

export const Playlists: React.FC<PlaylistsProps> = ({ onPlay: _onPlay }) => {
  const gridStyle = useGridStyle({ gapRem: 1.5 });
  const navigate = useNavigate();
  const [playlists, setPlaylists] = useState<LocalPlaylist[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<PlaylistFilter>("All");
  const [order, setOrder] = useState<PlaylistListOrder>(loadPlaylistListOrder);
  const [customOrder, setCustomOrder] = useState<string[]>(loadPlaylistCustomOrder);
  const [compact, setCompact] = useState<boolean>(loadPlaylistsCompact);
  const dragSensors = useListDragSensors();
  // The account's playlists lead, in the server's order: the list is the
  // account's playlists while signed in, as Android's PlaylistsViewModel
  // shows them. System lists are not cards here — Watch Later has its own
  // row, Liked videos has the Liked page, Liked Music is music.
  const serverPlaylists = useServerPlaylistsStore((s) => s.playlists);
  const loadServerPlaylists = useServerPlaylistsStore((s) => s.load);
  const deleteServerPlaylist = useServerPlaylistsStore((s) => s.deletePlaylist);

  const visibleServerPlaylists = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return serverPlaylists.filter((playlist) => {
      if (isSystemServerPlaylistId(playlist.id)) return false;
      if (filter === "Saved") return false;
      return !query || playlist.title.toLowerCase().includes(query);
    });
  }, [filter, searchQuery, serverPlaylists]);

  const visiblePlaylists = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    const matching = playlists.filter((playlist) => {
      const source = playlist.source ?? "Owned";
      const matchesFilter = filter === "All" || source === filter;
      const matchesSearch = !query || [
        playlist.name,
        playlist.description ?? "",
        ...playlist.tracks.map((track) => track.title),
      ].some((value) => value.toLowerCase().includes(query));

      return matchesFilter && matchesSearch;
    });
    return sortStoredPlaylists(matching, order, customOrder);
  }, [customOrder, filter, order, playlists, searchQuery]);

  // Only the whole list can be dragged: with some hidden, a drop has no clear place among them.
  const canDrag = order === "custom" && filter === "All" && !searchQuery.trim();

  const loadPlaylists = async () => {
    try {
      setPlaylists(await loadStoredPlaylists());
    } catch (e) {
      console.error("Failed to load playlists", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPlaylists();
    void loadServerPlaylists();
    window.addEventListener(PLAYLIST_LIBRARY_UPDATED_EVENT, loadPlaylists);
    return () => window.removeEventListener(PLAYLIST_LIBRARY_UPDATED_EVENT, loadPlaylists);
  }, [loadServerPlaylists]);

  const handleCreatePlaylist = async (name: string, description: string) => {
    try {
      if (await getAccountSignedIn().catch(() => false)) {
        // Signed in, the playlist is created on the account, as Android
        // does — the description stays local-only, the account API takes
        // a title only.
        await useServerPlaylistsStore.getState().create(name);
      } else {
        await createStoredPlaylist(name, description);
      }
      setShowCreateModal(false);
    } catch (e) {
      console.error("Failed to create playlist", e);
      useUiStore.getState().showToast({ variant: "error", message: getString("playlist_create_failed") });
    }
  };

  const handleOrderChange = (next: PlaylistListOrder) => {
    setOrder(next);
    savePlaylistListOrder(next);
  };

  const handleCompactChange = () => {
    setCompact((current) => {
      savePlaylistsCompact(!current);
      return !current;
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const ids = visiblePlaylists.map((playlist) => playlist.id);
    const move = resolveDragMove(event, ids);
    if (!move) return;
    const next = arrayMove(ids, move[0], move[1]);
    setCustomOrder(next);
    savePlaylistCustomOrder(next);
  };

  const handlePlaylistClick = (playlist: PlaylistSummary) => {
    navigate(`/playlist/${playlist.id}`);
  };

  const handleSaveToLibrary = async (playlist: PlaylistSummary) => {
    const updated = await savePlaylistToLibrary(playlist);
    setPlaylists(updated);
    return true;
  };

  const handleRemoveFromLibrary = async (playlist: PlaylistSummary) => {
    const updated = await removePlaylistFromLibrary(playlist.id);
    setPlaylists(updated);
    return true;
  };

  const handleServerRemove = async (playlist: PlaylistSummary) => {
    if (!await confirmPlaylistRemoval(playlist, true)) return false;
    try {
      await deleteServerPlaylist(playlist.id);
      return true;
    } catch (e) {
      console.error("Failed to delete playlist", e);
      useUiStore.getState().showToast({ variant: "error", message: getString("playlist_delete_failed") });
      return false;
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="space-y-6 pb-20">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-chrome-neutral-100">{getString('library_playlists_label')}</h1>
              <p className="mt-1 text-sm text-chrome-neutral-400">
                Manage owned and saved media collections from one dashboard.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <SearchInput
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={getString('playlists_search_playlists')}
                containerClassName="w-full sm:w-72"
              />
              <OpenPlaylistFileButton />
              <Button onClick={() => setShowCreateModal(true)} className="shrink-0">
                <Plus size={16} />
                Create Playlist
              </Button>
            </div>
          </div>

          <div className="mt-6 mb-6 flex flex-col gap-4 md:flex-row md:items-center">
            <Select
              value={order}
              onChange={(value) => handleOrderChange(value as PlaylistListOrder)}
              options={PLAYLIST_LIST_ORDERS.map((value) => ({ value, label: playlistListOrderLabel(value) }))}
              className="w-full md:w-52"
            />

            <Button
              type="button"
              variant="secondary"
              onClick={handleCompactChange}
              aria-label={getString(compact ? "playlists_show_grid" : "playlists_show_list")}
              title={getString(compact ? "playlists_show_grid" : "playlists_show_list")}
            >
              {compact ? <LayoutGrid size={16} /> : <List size={16} />}
              {getString(compact ? "playlists_show_grid" : "playlists_show_list")}
            </Button>

            <CategoryChips
              categories={FILTERS}
              activeCategory={filter}
              onCategoryChange={(category) => {
                if (FILTERS.includes(category as PlaylistFilter)) {
                  setFilter(category as PlaylistFilter);
                }
              }}
              sticky={false}
              className="py-0"
            />
          </div>

          {canDrag && visiblePlaylists.length > 1 ? (
            <p className="text-sm text-chrome-neutral-400">{getString("playlists_drag_hint")}</p>
          ) : null}

          {loading ? (
            <div className="flex flex-col items-center justify-center space-y-4 py-32">
              <Loader2 className="animate-spin text-[var(--color-primary)]" size={36} />
              <p className="text-sm font-medium text-chrome-neutral-500">{getString('playlists_assembling_library_index')}</p>
            </div>
          ) : playlists.length === 0 && visibleServerPlaylists.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-chrome-neutral-800 bg-surface-container-low p-8 py-24 text-center">
              <ListVideo className="mb-4 text-chrome-neutral-600" size={48} />
              <h3 className="font-medium text-chrome-neutral-200">{getString('playlists_no_playlists_yet')}</h3>
              <p className="mt-1 max-w-sm text-sm text-chrome-neutral-500">
                Create a playlist to start building a media collection.
              </p>
            </div>
          ) : visiblePlaylists.length === 0 && visibleServerPlaylists.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-chrome-neutral-800 bg-surface-container-low p-8 py-20 text-center">
              <ListVideo className="mb-4 text-chrome-neutral-600" size={44} />
              <h3 className="font-medium text-chrome-neutral-200">{getString('playlists_no_matching_playlists')}</h3>
              <p className="mt-1 max-w-sm text-sm text-chrome-neutral-500">
                Try a different search, filter, or sort option.
              </p>
            </div>
          ) : (
            <DndContext sensors={dragSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={visiblePlaylists.map((playlist) => playlist.id)} strategy={rectSortingStrategy}>
                <div className={compact ? "flex flex-col gap-3" : "video-grid gap-y-6"} style={compact ? undefined : gridStyle}>
                  {visibleServerPlaylists.map((playlist) => (
                    <PlaylistCard
                      key={playlist.id}
                      playlist={playlist}
                      isInLibrary
                      onClick={handlePlaylistClick}
                      onSaveToLibrary={() => true}
                      onRemoveFromLibrary={handleServerRemove}
                    />
                  ))}
                  {visiblePlaylists.map((playlist) => {
                    const card = (
                      <PlaylistCard
                        key={playlist.id}
                        playlist={storedPlaylistToCardSummary(playlist)}
                        isInLibrary={playlists.some((localPlaylist) => localPlaylist.id === playlist.id)}
                        onClick={handlePlaylistClick}
                        onSaveToLibrary={handleSaveToLibrary}
                        onRemoveFromLibrary={handleRemoveFromLibrary}
                      />
                    );
                    return canDrag ? <DraggablePlaylist key={playlist.id} id={playlist.id}>{card}</DraggablePlaylist> : card;
                  })}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

      {showCreateModal && (
        <PlaylistFormDialog
          title={getString('playlist_add_modal_create')}
          confirmLabel={getString('playlist_create')}
          onSubmit={handleCreatePlaylist}
          onCancel={() => setShowCreateModal(false)}
        />
      )}

    </div>
  );
};

export default Playlists;
