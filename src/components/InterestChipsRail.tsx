"use client";

import { Button } from "@/components/ui/button";
import React, { useMemo } from "react";
import { FaSlidersH } from "react-icons/fa";
import { orderInterestsForRail, type PoemInterest } from "@/data/interests";

interface InterestChipsRailProps {
  selectedKeys: string[];
  activeKeys: string[];
  onToggle: (key: string) => void;
  onClear: () => void;
  onOpenPicker: () => void;
  isLoading?: boolean;
}

const InterestChipsRail: React.FC<InterestChipsRailProps> = ({
  selectedKeys,
  activeKeys,
  onToggle,
  onClear,
  onOpenPicker,
  isLoading = false,
}) => {
  const interests = useMemo<PoemInterest[]>(
    () => orderInterestsForRail(selectedKeys).filter((interest) => selectedKeys.includes(interest.key)),
    [selectedKeys],
  );
  const activeKeySet = useMemo(() => new Set(activeKeys), [activeKeys]);
  const hasActive = activeKeySet.size > 0;

  return (
    <div
      className={`interest-rail${isLoading ? " is-loading" : ""}`}
      role="group"
      aria-label="دسته‌بندی شعرها"
      dir="rtl"
    >
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="interest-rail-settings"
        onClick={onOpenPicker}
        aria-label="ویرایش علاقه‌مندی‌ها"
        title="ویرایش علاقه‌مندی‌ها"
      >
        <FaSlidersH aria-hidden="true" />
      </Button>
      {interests.length > 0 && (
      <div className="interest-rail-track">
        <Button
          type="button"
          variant={hasActive ? "outline" : "default"}
          className={`interest-chip${hasActive ? "" : " is-active"}`}
          onClick={onClear}
          aria-pressed={!hasActive}
        >
          همه
        </Button>
        {interests.map((interest) => {
          const isActive = activeKeySet.has(interest.key);
          return (
            <Button
              type="button"
              variant={isActive ? "default" : "outline"}
              key={interest.key}
              className={`interest-chip${isActive ? " is-active" : ""}`}
              onClick={() => onToggle(interest.key)}
              aria-pressed={isActive}
            >
              {interest.label}
            </Button>
          );
        })}
      </div>
      )}
    </div>
  );
};

export default InterestChipsRail;
