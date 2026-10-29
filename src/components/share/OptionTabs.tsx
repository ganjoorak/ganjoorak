"use client";

import type React from "react";
import { Tabs, TabsIndicator, TabsList, TabsTab } from "@/components/ui/tabs";

export type TabOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
  title?: string;
  style?: React.CSSProperties;
};

/** One choice per row, in the pill tabs the poets page uses for its categories. */
export function OptionTabs<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<TabOption<T>>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="share-option">
      <Tabs
        value={value}
        onValueChange={(next) => onChange(next as T)}
        className="share-option__tabs min-w-0 flex-1"
      >
        <TabsList className="share-tabs relative" aria-label={label}>
          <TabsIndicator />
          {options.map((option) => (
            <TabsTab
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              title={option.title}
              style={option.style}
              className="relative data-active:bg-transparent data-active:shadow-none"
            >
              {option.label}
            </TabsTab>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
