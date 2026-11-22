import { useEffect, useState } from "react";
import { Loader2, Search, SearchX } from "lucide-react";
import { ChannelCard } from "../channel/ChannelCard";
import { EmptyState } from "../ui/EmptyState";
import { SearchInput } from "../ui/SearchInput";
import { getPlural, getString } from "../../lib/i18n/index";
import { useChannelSearch } from "../../lib/useChannelSearch";
import { getAccountSignedIn } from "../../lib/api/account";
import { useSubscriptionStore } from "../../store/useSubscriptionStore";
import { useNotificationStore } from "../../store/useNotificationStore";
import { useUiStore } from "../../store/useUiStore";
import { ONBOARDING_CARD_GRID } from "./constants";

export function ChannelsStep({ onRequestSignIn }: { onRequestSignIn?: () => void }) {
  const [searchQuery, setSearchQuery] = useState("");
  const subscriptions = useSubscriptionStore((state) => state.subscriptions);
  const loadSubscriptions = useSubscriptionStore((state) => state.loadSubscriptions);
  const loadChannelPreferences = useNotificationStore((state) => state.loadChannelPreferences);
  const showToast = useUiStore((state) => state.showToast);
  const { channels, loading } = useChannelSearch(searchQuery);

  useEffect(() => {
    void loadSubscriptions();
    void loadChannelPreferences();
  }, [loadSubscriptions, loadChannelPreferences]);

  // A signed-out subscribe tap asks for sign-in instead of writing a local
  // subscription, as Android's ChannelsStep does.
  const signInGate = async (): Promise<boolean> => {
    if (await getAccountSignedIn()) return true;
    showToast({ message: getString("onboarding_channels_sign_in_required"), variant: "error" });
    onRequestSignIn?.();
    return false;
  };

  const toggleSubscribed = async (channel: (typeof channels)[number]) => {
    const { isSubscribed, subscribe, unsubscribe } = useSubscriptionStore.getState();
    if (isSubscribed(channel.channelId)) {
      void unsubscribe(channel.channelId, { learn: true });
      return;
    }
    if (!(await signInGate())) return;
    void subscribe(channel.channelId, channel.name, channel.avatarUrl ?? undefined, { learn: true });
  };

  return (
    <div className="flex w-full flex-col gap-8 pb-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="mb-3 text-5xl font-semibold tracking-tight text-chrome-neutral-100">
            {getString("onboarding_channels_title")}
          </h1>
          <p className="text-lg text-chrome-neutral-400">{getString("onboarding_channels_subtitle")}</p>
        </div>
        {subscriptions.length > 0 && (
          <span className="shrink-0 rounded-full bg-surface-container-high px-4 py-2 text-xs font-medium text-chrome-neutral-200">
            {getPlural("onboarding_channels_configured", subscriptions.length)}
          </span>
        )}
      </div>

      <SearchInput
        pill
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        placeholder={getString("onboarding_type_creator_or_channel_name")}
        trailing={loading ? <Loader2 size={16} className="animate-spin text-primary" /> : null}
      />

      {searchQuery.trim() ? (
        channels.length === 0 && !loading ? (
          <EmptyState icon={SearchX} title={getString("onboarding_channels_no_results", searchQuery.trim())} />
        ) : (
          <div className={ONBOARDING_CARD_GRID}>
            {channels.map((channel) => (
              <ChannelCard
                key={channel.channelId}
                fill
                channelId={channel.channelId}
                name={channel.name}
                avatarUrl={channel.avatarUrl}
                subtitle={channel.subscriberCountText ?? channel.handle}
                onOpen={() => void toggleSubscribed(channel)}
                onSubscribeRequest={signInGate}
                showNotificationToggle
              />
            ))}
          </div>
        )
      ) : (
        <EmptyState
          icon={Search}
          title={getString("onboarding_search_for_creators")}
        />
      )}
    </div>
  );
}

export default ChannelsStep;
