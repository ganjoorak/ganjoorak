"use client";

import { useLayoutEffect, useRef } from "react";

import type { FeedMode } from "@/context/SettingsContext";

interface FeedModeSwitchProps {
  mode: FeedMode;
  onChange: (mode: FeedMode) => void;
  isLoading?: boolean;
}

const OPTIONS: { value: FeedMode; label: string }[] = [
  { value: "all", label: "همه" },
  { value: "following", label: "دنبال‌شده‌ها" },
];

const EASING = "cubic-bezier(0.32, 0.72, 0, 1)";
const DURATION = 280;
// Further than this and the old switch was scrolled away, so there is nothing to glide from.
const MAX_GLIDE = 120;

// The switch is remounted whenever the home page swaps trees (poem ⇄ empty state ⇄ loading), which would make
// the thumb snap to the new mode and the switch jump to its new spot. Remembering what the last instance showed,
// and where, lets a fresh instance animate from there. Only touched in layout effects, so SSR is unaffected.
let lastShownMode: FeedMode | null = null;
let lastTop: number | null = null;

const thumbOffset = (mode: FeedMode) =>
  // The switch is always dir="rtl": the second option sits left of the first.
  mode === "following" ? "translateX(-100%)" : "translateX(0)";

/** Compact segmented control that picks the home feed source. */
const FeedModeSwitch = ({ mode, onChange, isLoading = false }: FeedModeSwitchProps) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const top = root.getBoundingClientRect().top;
    const glide = lastTop === null ? 0 : lastTop - top;
    if (!reduceMotion && Math.abs(glide) > 1 && Math.abs(glide) < MAX_GLIDE) {
      root.animate([{ translate: `0 ${glide}px` }, { translate: "0 0" }], {
        duration: DURATION,
        easing: EASING,
      });
    }

    if (!reduceMotion && lastShownMode && lastShownMode !== modeRef.current) {
      thumbRef.current?.animate(
        [{ transform: thumbOffset(lastShownMode) }, { transform: thumbOffset(modeRef.current) }],
        { duration: DURATION, easing: EASING },
      );
    }

    return () => {
      // Runs while the old tree is still laid out, before it leaves the DOM.
      lastTop = root.getBoundingClientRect().top;
    };
  }, []);

  useLayoutEffect(() => {
    lastShownMode = mode;
  }, [mode]);

  return (
    <div
      ref={rootRef}
      className={`feed-mode-switch${isLoading ? " is-loading" : ""}`}
      dir="rtl"
      role="tablist"
      aria-label="منبع فید"
      data-mode={mode}
    >
      <span ref={thumbRef} className="feed-mode-thumb" aria-hidden="true" />
      {OPTIONS.map((option) => {
        const isActive = option.value === mode;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`feed-mode-option${isActive ? " is-active" : ""}`}
            onClick={() => {
              if (!isActive) onChange(option.value);
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
};

export default FeedModeSwitch;
