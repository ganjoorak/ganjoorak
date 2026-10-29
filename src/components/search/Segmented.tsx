"use client";

import { motion } from "framer-motion";
import { formatPersianNumber } from "@/utils/searchText";

export const Segmented = <T extends string>({
  label,
  options,
  value,
  onChange,
  counts,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  counts?: Partial<Record<T, number | null>>;
}) => (
  <div className="search-segmented" role="group" aria-label={label}>
    {options.map((option) => {
      const active = value === option.value;
      const count = counts?.[option.value];
      return (
        <button
          key={option.value}
          type="button"
          className={`search-segment${active ? " is-active" : ""}`}
          aria-pressed={active}
          onClick={() => onChange(option.value)}
        >
          {active && (
            <motion.span
              layoutId={`segment-${label}`}
              className="search-segment-thumb"
              transition={{ type: "spring", stiffness: 520, damping: 40 }}
            />
          )}
          <span className="search-segment-label">
            {option.label}
            {count != null && count > 0 && <small>{formatPersianNumber(count)}</small>}
          </span>
        </button>
      );
    })}
  </div>
);
