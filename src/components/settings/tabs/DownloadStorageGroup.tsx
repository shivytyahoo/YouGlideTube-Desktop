import { SettingsGroup } from '../SettingsGroup';
import { SettingItem } from '../SettingItem';
import { Select } from '../../ui/Select';
import { formatBytes } from '../../../lib/downloadOptions';
import { getString, type StringKey } from '../../../lib/i18n/index';
import { SETTINGS } from '../../../lib/settings/schema';
import { useNumberPref } from '../../../lib/usePreference';
import { useDownloadStorageUsage } from '../../../lib/downloadStorage/useDownloadStorageUsage';
import type { DownloadStorageKind, DownloadStorageRow } from '../../../lib/api/downloadStorage';

/** Android's size choices for a download type, in megabytes; 0 means no limit. */
const LIMIT_OPTIONS_MB = [100, 200, 500, 1024, 2048, 5120, 0];

const COPY: Record<DownloadStorageKind, { title: StringKey; description: StringKey }> = {
  video: { title: 'settings_download_storage_videos', description: 'settings_download_storage_videos_desc' },
  music: { title: 'settings_download_storage_songs', description: 'settings_download_storage_songs_desc' },
};

const limitLabel = (megabytes: number) =>
  megabytes === 0 ? getString('settings_option_unlimited') : megabytes >= 1000 ? `${megabytes / 1000} GB` : `${megabytes} MB`;

function describe(row: DownloadStorageRow | undefined): string {
  if (!row) return getString('settings_download_storage_measuring');
  const used = formatBytes(row.bytes) ?? '0 MB';
  return row.limitMb === 0
    ? getString('settings_download_storage_used_no_limit', used)
    : getString('settings_download_storage_used_of_limit', used, limitLabel(row.limitMb));
}

/** The meter Android's cache section has, split by download type. */
function StorageMeter({ video, music }: { video?: DownloadStorageRow; music?: DownloadStorageRow }) {
  const videoBytes = video?.bytes ?? 0;
  const musicBytes = music?.bytes ?? 0;
  const total = videoBytes + musicBytes;
  const videoShare = total > 0 ? videoBytes / total : 0;
  const size = (bytes: number) => formatBytes(bytes) ?? '0 MB';
  return (
    <div className="px-4 py-3">
      <div className="text-sm text-chrome-neutral-100">
        {video === undefined && music === undefined
          ? getString('settings_download_storage_measuring')
          : getString('settings_download_storage_total', size(total))}
      </div>
      <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface-container-highest">
        {total > 0 && (
          <>
            <div style={{ width: `${videoShare * 100}%`, backgroundColor: '#1E5AA8' }} />
            <div style={{ width: `${(1 - videoShare) * 100}%`, backgroundColor: '#E85D04' }} />
          </>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-chrome-neutral-400">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#1E5AA8' }} />
          {getString('settings_download_storage_videos')}: {size(videoBytes)}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#E85D04' }} />
          {getString('settings_download_storage_songs')}: {size(musicBytes)}
        </span>
      </div>
    </div>
  );
}

export function DownloadStorageGroup() {
  const { usage, refresh } = useDownloadStorageUsage();
  const [videoLimit, setVideoLimit] = useNumberPref(SETTINGS.DOWNLOAD_VIDEO_STORAGE_LIMIT_MB, 0);
  const [musicLimit, setMusicLimit] = useNumberPref(SETTINGS.DOWNLOAD_MUSIC_STORAGE_LIMIT_MB, 0);
  const limits: Record<DownloadStorageKind, { limit: number; setLimit: (value: number) => void }> = {
    video: { limit: videoLimit, setLimit: setVideoLimit },
    music: { limit: musicLimit, setLimit: setMusicLimit },
  };

  const video = usage?.find((row) => row.kind === 'video');
  const music = usage?.find((row) => row.kind === 'music');

  return (
    <SettingsGroup title={getString('settings_group_download_storage')}>
      <StorageMeter video={video} music={music} />
      {(Object.keys(COPY) as DownloadStorageKind[]).map((kind) => {
        const row = kind === 'video' ? video : music;
        const { limit, setLimit } = limits[kind];
        return (
          <SettingItem
            key={kind}
            title={getString(COPY[kind].title)}
            description={`${getString(COPY[kind].description)} ${describe(row)}.`}
          >
            <Select
              value={String(row?.limitMb ?? limit)}
              onChange={(value) => {
                setLimit(Number(value));
                void refresh();
              }}
              disabled={!row}
              options={LIMIT_OPTIONS_MB.map((option) => ({ value: String(option), label: limitLabel(option) }))}
            />
          </SettingItem>
        );
      })}
    </SettingsGroup>
  );
}
