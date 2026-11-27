import { useMemo } from 'react';
import { SettingsGroup } from '../SettingsGroup';
import { SettingItem } from '../SettingItem';
import { Select } from '../../ui/Select';
import { ToggleSwitch } from '../../ui/ToggleSwitch';
import { useBoolPref, usePreference } from '../../../lib/usePreference';
import { APP_LOCALE, getString } from '../../../lib/i18n/index';
import { SETTINGS } from '../../../lib/settings/schema';
import { isSettingDisabledUntilWired } from '../../../lib/settings/values';
import { audioLanguageOptions } from '../../../lib/audioLanguages';
import { deviceSupportsCodec, isCodecFailingOnDevice, type VideoCodecFamily } from '../../../lib/codecHealth';
import { useCodecHealthStore } from '../../../store/useCodecHealthStore';
import { Button } from '../../ui/Button';

const QUALITY_OPTIONS = [
  { value: 'Auto', label: getString('quality_auto') }, { value: '4320p', label: '4320p (8K)' }, { value: '2160p', label: '2160p (4K)' },
  { value: '1440p', label: '1440p' }, { value: '1080p', label: '1080p' },
  { value: '720p', label: '720p' }, { value: '480p', label: '480p' },
  { value: '360p', label: '360p' }, { value: '240p', label: '240p' }, { value: '144p', label: '144p' },
];

const CODECS: Array<{ value: string; family: VideoCodecFamily }> = [
  { value: 'H.264', family: 'h264' },
  { value: 'VP9', family: 'vp9' },
  { value: 'AV1', family: 'av1' },
];

export function QualityTab() {
  const [qualityWifi, setQualityWifi] = usePreference(SETTINGS.DEFAULT_QUALITY_WIFI, '1080p');
  const [playbackMethod, setPlaybackMethod] = usePreference(SETTINGS.PLAYBACK_METHOD, 'auto');
  const [codec, setCodec] = usePreference(SETTINGS.DEFAULT_VIDEO_CODEC, 'H.264');
  const [fallbackCodec, setFallbackCodec] = usePreference(SETTINGS.FALLBACK_VIDEO_CODEC, 'Auto');
  const [groupedQualitySelector, setGroupedQualitySelector] = useBoolPref(SETTINGS.GROUPED_QUALITY_SELECTOR, false);
  const [feedPreviewQuality, setFeedPreviewQuality] = usePreference(SETTINGS.FEED_PREVIEW_QUALITY, 'auto');
  const [shortsPreviewQuality, setShortsPreviewQuality] = usePreference(SETTINGS.SHORTS_PREVIEW_QUALITY, 'auto');
  const [thumbnailQuality, setThumbnailQuality] = usePreference(SETTINGS.THUMBNAIL_QUALITY, 'auto');
  const [fastSwitch, setFastSwitch] = useBoolPref(SETTINGS.FAST_QUALITY_SWITCH_ENABLED);
  const [shortsQuality, setShortsQuality] = usePreference(SETTINGS.SHORTS_QUALITY_WIFI, '720p');
  const [groupedQuality, setGroupedQuality] = useBoolPref(SETTINGS.SHORTS_GROUPED_QUALITY, false);
  const [audioLang, setAudioLang] = usePreference(SETTINGS.PREFERRED_AUDIO_LANGUAGE, 'original');
  const decodeFailures = useCodecHealthStore((state) => state.failures);
  const clearCodecFailures = useCodecHealthStore((state) => state.clearFailures);
  const codecs = useMemo(() => CODECS.map((item) => {
    const unsupported = !deviceSupportsCodec(item.family);
    const failing = !unsupported && isCodecFailingOnDevice(decodeFailures, item.family);
    return { ...item, unsupported, failing, unavailable: unsupported || failing };
  }), [decodeFailures]);
  const codecOptions = useMemo(() => [
    { value: 'Auto', label: getString('quality_auto') },
    ...codecs.map((item) => ({
      value: item.value,
      disabled: item.unavailable,
      label: item.unsupported
        ? getString('settings_codec_unsupported', item.value)
        : item.failing ? getString('settings_codec_failing', item.value) : item.value,
    })),
  ], [codecs]);
  const chosenCodecUnavailable = codecs.some((item) => item.value === codec && item.unavailable);
  const languageOptions = useMemo(() => [
    { value: 'original', label: getString('settings_option_original') },
    ...audioLanguageOptions(APP_LOCALE),
  ], []);

  return (
    <div className="space-y-6 pb-8">
      <SettingsGroup title={getString('settings_group_video_quality')}>
        <SettingItem title={getString('settings_default_resolution')} description={getString('settings_default_resolution_desc')}>
          <Select value={qualityWifi} onChange={setQualityWifi} options={QUALITY_OPTIONS} />
        </SettingItem>
        <SettingItem
          title={getString('settings_playback_method')}
          description={getString('settings_playback_method_desc')}
        >
          <Select value={playbackMethod} onChange={setPlaybackMethod} options={[
            { value: 'auto', label: getString('settings_playback_method_auto') },
            { value: 'dash', label: getString('settings_playback_method_dash') },
            { value: 'sabr', label: getString('settings_playback_method_sabr') },
            { value: 'hls', label: getString('settings_playback_method_hls') },
            { value: 'direct', label: getString('settings_playback_method_direct') },
          ]} />
        </SettingItem>
        <SettingItem
          title={getString('settings_preferred_codec')}
          description={chosenCodecUnavailable
            ? getString('settings_preferred_codec_unavailable', codec)
            : getString('settings_preferred_codec_desc')}
        >
          <Select value={codec} onChange={setCodec} options={codecOptions} />
        </SettingItem>
        <SettingItem
          title={getString('settings_fallback_codec')}
          description={getString('settings_fallback_codec_desc')}
        >
          <Select
            value={fallbackCodec}
            onChange={setFallbackCodec}
            options={[
              { value: 'Auto', label: getString('quality_auto') },
              ...CODECS.filter((item) => item.value !== codec).map((item) => ({
                value: item.value,
                disabled: !deviceSupportsCodec(item.family),
                label: item.value,
              })),
            ]}
          />
        </SettingItem>
        <SettingItem title={getString('settings_grouped_quality_selector')} description={getString('settings_grouped_quality_selector_desc')}>
          <ToggleSwitch checked={groupedQualitySelector} onChange={setGroupedQualitySelector} />
        </SettingItem>
        {codecs.filter((item) => item.failing).map((item) => (
          <SettingItem
            key={item.family}
            title={getString('settings_codec_failing_title', item.value)}
            description={getString('settings_codec_failing_desc', item.value)}
          >
            <Button variant="secondary" size="sm" onClick={() => clearCodecFailures(item.family)}>
              {getString('settings_codec_try_again')}
            </Button>
          </SettingItem>
        ))}
        <SettingItem title={getString('settings_fast_quality_switch')} description={getString('settings_fast_quality_switch_desc')}>
          <ToggleSwitch checked={fastSwitch} onChange={setFastSwitch} />
        </SettingItem>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_shorts_quality')}>
        <SettingItem title={getString('settings_shorts_resolution')} description={getString('settings_shorts_resolution_desc')}>
          <Select value={shortsQuality} onChange={setShortsQuality} options={QUALITY_OPTIONS} />
        </SettingItem>
        <SettingItem title={getString('settings_grouped_quality_selector')} description={getString('settings_grouped_quality_selector_desc')}>
          <ToggleSwitch checked={groupedQuality} onChange={setGroupedQuality} />
        </SettingItem>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_preview_quality')}>
        <SettingItem title={getString('settings_feed_preview_quality')} description={getString('settings_feed_preview_quality_desc')}>
          <Select value={feedPreviewQuality} onChange={setFeedPreviewQuality} options={[
            { value: 'auto', label: getString('settings_quality_auto') },
            { value: 'low', label: getString('settings_quality_low') },
            { value: 'high', label: getString('settings_quality_high') },
          ]} />
        </SettingItem>
        <SettingItem title={getString('settings_shorts_preview_quality')} description={getString('settings_shorts_preview_quality_desc')}>
          <Select value={shortsPreviewQuality} onChange={setShortsPreviewQuality} options={[
            { value: 'auto', label: getString('settings_quality_auto') },
            { value: 'low', label: getString('settings_quality_low') },
            { value: 'high', label: getString('settings_quality_high') },
          ]} />
        </SettingItem>
        <SettingItem title={getString('settings_thumbnail_quality')} description={getString('settings_thumbnail_quality_desc')}>
          <Select value={thumbnailQuality} onChange={setThumbnailQuality} options={[
            { value: 'auto', label: getString('settings_quality_auto') },
            { value: 'standard', label: getString('settings_quality_standard') },
            { value: 'high', label: getString('settings_quality_high') },
          ]} />
        </SettingItem>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_audio')}>
        <SettingItem title={getString('settings_audio_track_language')} description={getString('settings_audio_track_language_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.PREFERRED_AUDIO_LANGUAGE)}>
          <Select value={audioLang} onChange={setAudioLang} options={languageOptions} disabled={isSettingDisabledUntilWired(SETTINGS.PREFERRED_AUDIO_LANGUAGE)} />
        </SettingItem>
      </SettingsGroup>
    </div>
  );
}
