import { useCallback, useEffect, useState } from "react";

import { getDownloadStorageUsage, type DownloadStorageRow } from "../api/downloadStorage";

/** Each download type's disk use and limit, measured when the page opens. */
export function useDownloadStorageUsage() {
  const [usage, setUsage] = useState<DownloadStorageRow[] | null>(null);

  const refresh = useCallback(async () => {
    setUsage(await getDownloadStorageUsage().catch(() => null));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { usage, refresh };
}
