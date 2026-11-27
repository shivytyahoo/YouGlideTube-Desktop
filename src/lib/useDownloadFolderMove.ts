import { useCallback, useState } from "react";

import {
  moveDownloadFolder,
  type DownloadMediaKind,
  type MoveDownloadFolderResult,
} from "./api/downloads";
import { pickFolder } from "./dialogs";
import { getString } from "./i18n/index";
import { isActiveStatus } from "./useDownloads";
import { useConfirmStore } from "../store/useConfirmStore";
import { useDownloadCollectionsLibraryStore } from "../store/useDownloadCollectionsLibraryStore";
import { useDownloadStore } from "../store/useDownloadStore";
import { useDownloadsLibraryStore } from "../store/useDownloadsLibraryStore";
import { useUiStore } from "../store/useUiStore";

/** Moving a download folder to a new home: pick, confirm, move, reload the library. */
export function useDownloadFolderMove() {
  const [moving, setMoving] = useState<DownloadMediaKind | null>(null);

  const moveFolder = useCallback(
    async (
      kind: DownloadMediaKind,
      currentPath: string,
    ): Promise<MoveDownloadFolderResult | null> => {
      const { showToast } = useUiStore.getState();
      if (
        Object.values(useDownloadStore.getState().active).some((item) =>
          isActiveStatus(item.status),
        )
      ) {
        showToast({ variant: "error", message: getString("downloads_move_active") });
        return null;
      }
      const path = await pickFolder(
        getString(
          kind === "video"
            ? "settings_video_download_folder"
            : "settings_music_download_folder",
        ),
      );
      if (!path || path === currentPath) return null;
      const confirmed = await useConfirmStore.getState().ask({
        title: getString("settings_move_folder_confirm_title"),
        message: getString(
          "settings_move_folder_confirm_body",
          kind,
          currentPath ||
            getString(
              kind === "video"
                ? "settings_system_default_videos"
                : "settings_system_default_music",
            ),
          path,
        ),
        confirmLabel: getString("settings_move_folder"),
      });
      if (!confirmed) return null;
      setMoving(kind);
      try {
        const result = await moveDownloadFolder(kind, path);
        await useDownloadsLibraryStore.getState().load();
        await useDownloadCollectionsLibraryStore.getState().load();
        showToast({
          variant: "success",
          message:
            result.movedFiles > 0
              ? getString("downloads_move_done", result.movedFiles)
              : getString("downloads_move_empty"),
        });
        return result;
      } catch (error) {
        console.error("Failed to move the download folder", error);
        showToast({ variant: "error", message: getString("downloads_move_failed") });
        return null;
      } finally {
        setMoving(null);
      }
    },
    [],
  );

  return { moving, moveFolder };
}
