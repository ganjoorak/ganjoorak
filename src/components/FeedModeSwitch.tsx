"use client";

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

/** Compact segmented control that picks the home feed source. */
const FeedModeSwitch = ({ mode, onChange, isLoading = false }: FeedModeSwitchProps) => (
  <div
    className={`feed-mode-switch${isLoading ? " is-loading" : ""}`}
    dir="rtl"
    role="tablist"
    aria-label="منبع فید"
    data-mode={mode}
  >
    <span className="feed-mode-thumb" aria-hidden="true" />
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

export default FeedModeSwitch;
