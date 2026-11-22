import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Plus, Bell, BellRing } from 'lucide-react';
import { useSubscriptionStore } from '../../store/useSubscriptionStore';
import { useNotificationStore } from '../../store/useNotificationStore';
import { Button } from '../ui/Button';
import { getString } from '../../lib/i18n/index';
import { upgradeAvatarUrl } from '../../lib/thumbnails';
import { useImageFallback } from '../../lib/useImageFallback';
import { useProxiedImageUrl } from '../../lib/useProxiedImageUrl';
import { ColorWash, COLOR_WASH_HOST } from '../ui/ColorWash';
import { useHoverWashColor } from '../../lib/useHoverWashColor';
import { backgroundTabClickProps, openedInBackgroundTab } from '../../lib/openTarget';

export interface ChannelCardProps {
  channelId: string;
  name: string;
  avatarUrl?: string | null;
  subtitle?: string | null;
  fill?: boolean;
  className?: string;
  /** Replaces opening the channel's page. */
  onOpen?: () => void;
  /**
   * Asked before the subscribe button toggles; returning false blocks it
   * (a signed-out subscribe tap can ask for sign-in instead).
   */
  onSubscribeRequest?: () => Promise<boolean>;
  /** Shows the per-channel notification bell beside the subscribe button, once subscribed. */
  showNotificationToggle?: boolean;
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function CircleAvatar({ src, name }: { src?: string | null; name: string }) {
  const imageSrc = useProxiedImageUrl(upgradeAvatarUrl(src));
  const { src: displaySrc, onError } = useImageFallback([imageSrc]);
  if (!displaySrc) {
    return (
      <div className="grid h-full w-full place-items-center rounded-full bg-surface-container-high text-2xl font-semibold text-chrome-neutral-500">
        {name.charAt(0).toUpperCase() || '?'}
      </div>
    );
  }
  return (
    <img
      src={displaySrc}
      alt={name}
      loading="lazy"
      onError={onError}
      className="h-full w-full rounded-full object-cover"
    />
  );
}

export function ChannelCard({
  channelId,
  name,
  avatarUrl,
  subtitle,
  fill,
  className,
  onOpen,
  onSubscribeRequest,
  showNotificationToggle,
}: ChannelCardProps) {
  const navigate = useNavigate();
  const washSrc = useProxiedImageUrl(upgradeAvatarUrl(avatarUrl));
  const wash = useHoverWashColor(washSrc);
  const cleanId = channelId.replace('channel:', '');
  const isSubscribed = useSubscriptionStore((s) => s.isSubscribed);
  const subscribe = useSubscriptionStore((s) => s.subscribe);
  const unsubscribe = useSubscriptionStore((s) => s.unsubscribe);
  const subscribed = isSubscribed(cleanId);
  const channelNotificationsEnabled = useNotificationStore((s) => s.isChannelNotificationEnabled(cleanId));
  const setChannelNotification = useNotificationStore((s) => s.setChannelNotification);

  const route = `/channel/${cleanId}`;
  const open = (event?: React.MouseEvent) => {
    if (onOpen) {
      onOpen();
      return;
    }
    if (!cleanId || openedInBackgroundTab(event, route)) return;
    navigate(route);
  };

  const toggleSubscribe = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!cleanId) return;
    // The gate only guards subscribing; unsubscribing a local subscription
    // must always work, signed in or not.
    if (!subscribed && onSubscribeRequest && !(await onSubscribeRequest())) return;
    if (subscribed) {
      void unsubscribe(cleanId, { learn: true });
    } else {
      void subscribe(cleanId, name, avatarUrl ?? undefined, { learn: true });
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      {...(cleanId && !onOpen ? backgroundTabClickProps(route) : {})}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
      onMouseEnter={wash.onMouseEnter}
      onMouseLeave={wash.onMouseLeave}
      className={cx(
        `group ${COLOR_WASH_HOST} flex cursor-pointer flex-col items-center gap-3 rounded-2xl text-center outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]`,
        fill ? 'w-full' : 'w-40 md:w-48',
        className,
      )}
    >
      <ColorWash active={wash.isHovered} color={wash.color} radius="rounded-2xl" bleed={6} />
      <div className="aspect-square w-full">
        <div className="h-full w-full overflow-hidden rounded-full ring-1 ring-chrome-neutral-800/50 transition-transform duration-200 ease-out group-hover:scale-[1.02]">
          <CircleAvatar src={avatarUrl} name={name} />
        </div>
      </div>

      <div className="flex w-full flex-col items-center gap-0.5">
        <span dir="auto" className="line-clamp-1 font-semibold text-chrome-neutral-100">{name}</span>
        <span className="line-clamp-1 text-sm text-chrome-neutral-400">{subtitle || getString('search_role_channel')}</span>
      </div>

      <div className="mt-1 flex items-center gap-2">
        <Button
          variant={subscribed ? 'secondary' : 'primary'}
          size="sm"
          onClick={(e) => void toggleSubscribe(e)}
          aria-pressed={subscribed}
        >
          {subscribed ? (
            <>
              <Check className="h-4 w-4" /> {getString('search_subscribed')}
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" /> {getString('search_subscribe')}
            </>
          )}
        </Button>
        {showNotificationToggle && subscribed && (
          <button
            type="button"
            aria-label={getString('onboarding_channels_notif')}
            aria-pressed={channelNotificationsEnabled}
            title={getString('onboarding_channels_notif')}
            onClick={(e) => {
              e.stopPropagation();
              void setChannelNotification(cleanId, !channelNotificationsEnabled);
            }}
            className={`rounded-full p-2 transition-colors hover:bg-chrome-neutral-800 ${
              channelNotificationsEnabled ? 'text-primary' : 'text-chrome-neutral-400'
            }`}
          >
            {channelNotificationsEnabled ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );
}

export default ChannelCard;
