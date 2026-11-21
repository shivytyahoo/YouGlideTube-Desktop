import { useEffect, useRef, useState } from "react";

import { Logo } from "./common/Logo";
import { getString } from "../lib/i18n/index";
import { useTheme } from "../lib/useTheme";

/**
 * YouGlideTube's cold-start brand moment, as on Android
 * (YouGlideTubeLaunchIntro.kt): a pure overlay — the home feed composes and
 * loads underneath from the first frame, so the intro never delays content,
 * and it unmounts for good once dismissed.
 *
 * On the splash background a saffron arc draws itself around the badge (a
 * coral arc chases it), the badge springs in, the wordmark rises letter by
 * letter, and the tagline fades in — then the whole overlay fades away.
 *
 * Timings and geometry are Android's, verbatim:
 * - ring 780ms, FastOutSlowIn; primary arc sweeps 305 degrees, the coral
 *   chaser 44 degrees, starting 14 degrees behind the primary's leading edge
 * - letters start at 140ms, 42ms apart, 320ms each
 * - tagline fades in over 500ms from 480ms
 * - the overlay starts fading at 1330ms and is gone at 1670ms
 *
 * Colours are Android's too: the arcs are the fixed brand saffron (#E85D04)
 * and coral (#FF3D68) from GlidePalettes.kt — NOT the desktop theme's
 * primary/secondary slots (those are brand blue/saffron). The background and
 * foreground follow the light/dark variant from colors.xml:
 * light #FDFCFF / #1A1C1E, dark #0F0F0F / #F6F1FF.
 *
 * Skipped entirely when the battery-saver prop is on (Android skips on
 * LocalBatterySaver) or when the user prefers reduced motion. App wires the
 * prop to the battery saver setting, Android's first settings row.
 */

export const LAUNCH_INTRO_RING_MS = 780;
export const LAUNCH_INTRO_LETTER_DELAY_MS = 140;
export const LAUNCH_INTRO_LETTER_STAGGER_MS = 42;
export const LAUNCH_INTRO_LETTER_MS = 320;
export const LAUNCH_INTRO_TAGLINE_DELAY_MS = 480;
export const LAUNCH_INTRO_TAGLINE_MS = 500;
export const LAUNCH_INTRO_FADE_START_MS = 1330;
export const LAUNCH_INTRO_FADE_MS = 340;
/** Total: fade starts at 1330ms and takes 340ms. */
export const LAUNCH_INTRO_TOTAL_MS = LAUNCH_INTRO_FADE_START_MS + LAUNCH_INTRO_FADE_MS;

/** Compose's FastOutSlowInEasing. */
const EASING = "cubic-bezier(0.4, 0, 0.2, 1)";
/** Android's defaultSpatialSpec is a spring; the closest CSS curve overshoots. */
const SPRING_EASING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

const ARC_PRIMARY = "#E85D04";
const ARC_SECONDARY = "#FF3D68";
const RING_SIZE = 176;
const RING_STROKE = 4;
/** Android: stroke / 2 + 3dp. */
const RING_INSET = RING_STROKE / 2 + 3;
const RING_RADIUS = (RING_SIZE - RING_INSET * 2) / 2;
const RING_CENTER = RING_SIZE / 2;
const PRIMARY_SWEEP = 305;
const CHASER_SWEEP = 44;
const CHASER_GAP = 14;
const BADGE_SIZE = 124;

const LIGHT_BG = "#FDFCFF";
const LIGHT_FG = "#1A1C1E";
const DARK_BG = "#0F0F0F";
const DARK_FG = "#F6F1FF";

interface LaunchIntroProps {
  onDone: () => void;
  /** Wired to the battery saver setting by App. */
  batterySaver?: boolean;
}

export function LaunchIntro({ onDone, batterySaver = false }: LaunchIntroProps) {
  const { variant } = useTheme();
  const [appeared, setAppeared] = useState(false);
  const [fading, setFading] = useState(false);
  const [prefersReducedMotion] = useState(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const skipped = batterySaver || prefersReducedMotion;

  useEffect(() => {
    if (skipped) {
      onDoneRef.current();
      return;
    }
    setAppeared(true);
    const fadeTimer = window.setTimeout(() => setFading(true), LAUNCH_INTRO_FADE_START_MS);
    const doneTimer = window.setTimeout(() => onDoneRef.current(), LAUNCH_INTRO_TOTAL_MS);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(doneTimer);
    };
    // Runs once: the timers belong to this mount, not to the parent's re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (skipped) return null;

  const light = variant === "light";
  const background = light ? LIGHT_BG : DARK_BG;
  const foreground = light ? LIGHT_FG : DARK_FG;
  const wordmark = getString("app_name");
  const letters = wordmark.split("");

  return (
    <div
      data-testid="launch-intro"
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background,
        opacity: fading ? 0 : 1,
        transition: `opacity ${LAUNCH_INTRO_FADE_MS}ms ${EASING}`,
      }}
    >
      <div
        style={{
          position: "relative",
          width: RING_SIZE,
          height: RING_SIZE,
          marginBottom: 18,
          transform: `scale(${appeared ? 1 : 0.8})`,
          transition: `transform 600ms ${SPRING_EASING}`,
        }}
      >
        <svg
          width={RING_SIZE}
          height={RING_SIZE}
          style={{ position: "absolute", inset: 0 }}
          aria-hidden="true"
        >
          <g transform={`rotate(-90 ${RING_CENTER} ${RING_CENTER})`}>
            <circle
              cx={RING_CENTER}
              cy={RING_CENTER}
              r={RING_RADIUS}
              pathLength={360}
              fill="none"
              stroke={foreground}
              strokeOpacity={0.14}
              strokeWidth={RING_STROKE}
              strokeDasharray="360 360"
            />
            <circle
              cx={RING_CENTER}
              cy={RING_CENTER}
              r={RING_RADIUS}
              pathLength={360}
              fill="none"
              stroke={ARC_PRIMARY}
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={appeared ? `${PRIMARY_SWEEP} 360` : "0 360"}
              style={{ transition: `stroke-dasharray ${LAUNCH_INTRO_RING_MS}ms ${EASING}` }}
            />
            <circle
              cx={RING_CENTER}
              cy={RING_CENTER}
              r={RING_RADIUS}
              pathLength={360}
              fill="none"
              stroke={ARC_SECONDARY}
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={appeared ? `${CHASER_SWEEP} 360` : "0 360"}
              strokeDashoffset={appeared ? -(PRIMARY_SWEEP + CHASER_GAP) : -CHASER_GAP}
              style={{
                transition: `stroke-dasharray ${LAUNCH_INTRO_RING_MS}ms ${EASING}, stroke-dashoffset ${LAUNCH_INTRO_RING_MS}ms ${EASING}`,
              }}
            />
          </g>
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Logo size={BADGE_SIZE} />
        </div>
      </div>
      <div
        style={{
          display: "flex",
          marginBottom: 6,
          fontSize: 32,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          lineHeight: 1.2,
          color: foreground,
        }}
      >
        {letters.map((letter, index) => (
          <span
            key={`${index}-${letter}`}
            style={{
              display: "inline-block",
              opacity: appeared ? 1 : 0,
              transform: appeared ? "translateY(0)" : "translateY(14px)",
              transition: `opacity ${LAUNCH_INTRO_LETTER_MS}ms ${EASING} ${LAUNCH_INTRO_LETTER_DELAY_MS + index * LAUNCH_INTRO_LETTER_STAGGER_MS}ms, transform ${LAUNCH_INTRO_LETTER_MS}ms ${EASING} ${LAUNCH_INTRO_LETTER_DELAY_MS + index * LAUNCH_INTRO_LETTER_STAGGER_MS}ms`,
            }}
          >
            {letter}
          </span>
        ))}
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 500,
          letterSpacing: "0.01em",
          color: `${foreground}BF`,
          opacity: appeared ? 1 : 0,
          transition: `opacity ${LAUNCH_INTRO_TAGLINE_MS}ms ${EASING} ${LAUNCH_INTRO_TAGLINE_DELAY_MS}ms`,
        }}
      >
        {getString("app_tagline")}
      </div>
    </div>
  );
}

export default LaunchIntro;
