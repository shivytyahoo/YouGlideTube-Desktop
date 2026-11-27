import { EQ_SPATIAL_SOUNDS, EqLimits, type EqSpatialSound } from "../../../lib/audio/eq/models";
import { withBalance, withNightMode, withSpatialSound } from "../../../lib/audio/eq/stateOps";
import { useEqualizer } from "../../../lib/audio/eq/useEqualizer";
import { getString, type StringKey } from "../../../lib/i18n/index";
import { useEqStore } from "../../../store/useEqStore";
import { Chip } from "../../ui/Chip";
import { Slider } from "../../ui/Slider";
import { ToggleSwitch } from "../../ui/ToggleSwitch";

const WIDTH_LABELS: Record<EqSpatialSound, StringKey> = {
  OFF: "eq_spatial_off",
  LOW: "eq_spatial_low",
  MEDIUM: "eq_spatial_medium",
  HIGH: "eq_spatial_high",
};

/** Balance as the slider shows it: "Centre", or how far left or right. */
export function formatBalance(balance: number): string {
  if (balance === 0) return getString("eq_balance_center");
  return `${balance < 0 ? "L" : "R"} ${Math.round(Math.abs(balance) * 100)}`;
}

/**
 * The stereo stage of the equalizer — width, balance and night mode — shared by the quick panel
 * and the full editor, so music and video hear the same settings.
 */
export function EqStereoSection() {
  const eq = useEqualizer();
  const update = useEqStore((s) => s.update);
  const { state } = eq;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="me-1 text-sm text-chrome-neutral-200">{getString("eq_width")}</span>
        {EQ_SPATIAL_SOUNDS.map((sound) => (
          <Chip
            key={sound}
            active={state.spatialSound === sound}
            onClick={() => update((s) => withSpatialSound(s, sound))}
            className="h-7 px-2.5 text-xs"
          >
            {getString(WIDTH_LABELS[sound])}
          </Chip>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm text-chrome-neutral-200">{getString("eq_balance")}</span>
        <Slider
          min={EqLimits.MIN_BALANCE}
          max={EqLimits.MAX_BALANCE}
          step={0.05}
          value={state.balance}
          onChange={(balance) => update((s) => withBalance(s, balance))}
          aria-label={getString("eq_balance")}
          className="flex-1"
        />
        <span className="w-10 text-end font-mono text-xs text-chrome-neutral-400">{formatBalance(state.balance)}</span>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 flex-col">
          <span className="text-sm text-chrome-neutral-200">{getString("eq_night_mode")}</span>
          <span className="text-xs text-chrome-neutral-500">{getString("eq_night_mode_desc")}</span>
        </span>
        <ToggleSwitch checked={state.nightMode} onChange={(nightMode) => update((s) => withNightMode(s, nightMode))} />
      </div>
    </div>
  );
}
