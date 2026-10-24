"use client";

import { useEffect, useRef, useState } from "react";

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

// The switch is remounted whenever the home page swaps trees (poem ⇄ empty state, poem frame change), which
// would make the thumb snap to the new mode. Remembering what the last instance showed lets a fresh instance
// start there and slide to the current mode. Only written in an effect, so SSR and hydration are unaffected.
let lastShownMode: FeedMode | null = null;

/** Compact segmented control that picks the home feed source. */
const FeedModeSwitch = ({ mode, onChange, isLoading = false }: FeedModeSwitchProps) => {
  const thumbRef = useRef<HTMLSpanElement>(null);
  const [shownMode, setShownMode] = useState<FeedMode>(lastShownMode ?? mode);

  useEffect(() => {
    lastShownMode = mode;
    if (shownMode === mode) return;
    // Flush the thumb's current style first, otherwise a change in the same frame as the mount is not animated.
    thumbRef.current?.getBoundingClientRect();
    setShownMode(mode);
  }, [mode, shownMode]);

  return (
    <div
      className={`feed-mode-switch${isLoading ? " is-loading" : ""}`}
      dir="rtl"
      role="tablist"
      aria-label="منبع فید"
      data-mode={shownMode}
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
            className={`feed-mode-option${option.value === shownMode ? " is-active" : ""}`}
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
