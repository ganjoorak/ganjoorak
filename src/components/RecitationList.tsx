"use client";

import React from "react";
import { FaPlay } from "react-icons/fa";
import type { PoemRecitation } from "@/types/poem";
import { cn } from "@/lib/utils";

const toPersianDigits = (value: string) => value.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
const formatTime = (time: number) => {
  const safe = Number.isFinite(time) && time > 0 ? time : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  return toPersianDigits(`${minutes}:${seconds.toString().padStart(2, "0")}`);
};

const normalize = (value?: string) => (value || "").replace(/[\u200c\s]+/g, " ").trim();
/** The recitation's own title only when it says more than the reciter's name or the poem's title (Ganjoor usually repeats one). */
const subtitleFor = (recitation: PoemRecitation, poemTitle?: string) => {
  const title = normalize(recitation.audioTitle);
  const artist = normalize(recitation.audioArtist);
  if (!title || title === artist || title === normalize(poemTitle)) return "";
  if (artist && title.includes(artist) && title.length - artist.length < 4) return "";
  return title;
};

type RecitationListProps = {
  recitations: PoemRecitation[];
  currentIndex: number;
  isPlaying: boolean;
  /** Duration of the loaded recitation (Ganjoor's list carries none for the others). */
  currentDuration: number;
  onSelect: (index: number) => void;
  /** Hides recitation titles that only repeat the poem's title. */
  poemTitle?: string;
  className?: string;
};

/** Reciters of the poem; the row that is loaded in the player is highlighted, tapping a row plays it. */
export default function RecitationList({
  recitations,
  currentIndex,
  isPlaying,
  currentDuration,
  onSelect,
  poemTitle,
  className,
}: RecitationListProps) {
  if (recitations.length === 0) {
    return (
      <div dir="rtl" className={cn("recitation-list recitation-list--empty", className)}>
        خوانشی برای این شعر ثبت نشده است.
      </div>
    );
  }
  return (
    <ul dir="rtl" className={cn("recitation-list", className)} role="list">
      {recitations.map((recitation, index) => {
        const isCurrent = index === currentIndex;
        const subtitle = subtitleFor(recitation, poemTitle);
        const name = recitation.audioArtist?.trim() || "خوانش بی‌نام";
        return (
          <li key={recitation.id || index}>
            <button
              type="button"
              className={cn("recitation-row", isCurrent && "is-current", isCurrent && isPlaying && "is-playing")}
              aria-current={isCurrent ? "true" : undefined}
              onClick={() => onSelect(index)}
            >
              <span className="recitation-row-badge" aria-hidden="true">
                {isCurrent ? (
                  isPlaying ? (
                    <span className="recitation-eq">
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : (
                    <FaPlay />
                  )
                ) : (
                  toPersianDigits(String(index + 1))
                )}
              </span>
              <span className="recitation-row-text">
                <span className="recitation-row-name">{name}</span>
                {subtitle && <span className="recitation-row-title">{subtitle}</span>}
              </span>
              <span className="recitation-row-meta">
                {isCurrent && currentDuration > 0 ? formatTime(currentDuration) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
