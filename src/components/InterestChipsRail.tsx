"use client";

import React, { useMemo } from "react";
import { orderInterestsForRail, type PoemInterest } from "@/data/interests";

interface InterestChipsRailProps {
  selectedKeys: string[];
  activeKeys: string[];
  onToggle: (key: string) => void;
  onClear: () => void;
  isLoading?: boolean;
}

const InterestChipsRail: React.FC<InterestChipsRailProps> = ({
  selectedKeys,
  activeKeys,
  onToggle,
  onClear,
  isLoading = false,
}) => {
  const interests = useMemo<PoemInterest[]>(
    () => orderInterestsForRail(selectedKeys).filter((interest) => selectedKeys.includes(interest.key)),
    [selectedKeys],
  );
  const activeKeySet = useMemo(() => new Set(activeKeys), [activeKeys]);
  const hasActive = activeKeySet.size > 0;

  if (interests.length === 0) return null;

  return (
    <div
      className={`interest-rail${isLoading ? " is-loading" : ""}`}
      role="group"
      aria-label="دسته‌بندی شعرها"
      dir="rtl"
    >
      <div className="interest-rail-track">
        <button
          type="button"
          className={`interest-chip${hasActive ? "" : " is-active"}`}
          onClick={onClear}
          aria-pressed={!hasActive}
        >
          همهٔ موضوع‌ها
        </button>
        {interests.map((interest) => {
          const isActive = activeKeySet.has(interest.key);
          return (
            <button
              type="button"
              key={interest.key}
              className={`interest-chip${isActive ? " is-active" : ""}`}
              onClick={() => onToggle(interest.key)}
              aria-pressed={isActive}
            >
              {interest.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default InterestChipsRail;
