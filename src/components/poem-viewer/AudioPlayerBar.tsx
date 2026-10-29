"use client";

import { useEffect, useRef } from "react";
import {
  FaBackward,
  FaEye,
  FaEyeSlash,
  FaForward,
  FaListUl,
  FaPause,
  FaPlay,
  FaSpinner,
} from "react-icons/fa";
import { Button } from "@/components/ui/button";
import RecitationList from "@/components/RecitationList";
import type { Poem } from "@/types/poem";
import type { RecitationPlayer } from "./useRecitationPlayer";

const toPersianDigits = (value: number) =>
  String(value).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

// MM:SS
const formatTime = (time: number) => {
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

interface AudioPlayerBarProps {
  poem: Poem;
  player: RecitationPlayer;
  isHighlightEnabled: boolean;
  onToggleHighlight: () => void;
  /** The bar is expanded into the list of reciters. */
  isRecitersOpen: boolean;
  onRecitersOpenChange: (open: boolean) => void;
}

/** The desktop reading bar; it also holds the one <audio> element the mobile control drives. */
export default function AudioPlayerBar({
  poem,
  player,
  isHighlightEnabled,
  onToggleHighlight,
  isRecitersOpen,
  onRecitersOpenChange,
}: AudioPlayerBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const { isPlaying, isAudioLoading, currentTime, duration } = player;

  // Esc or a click anywhere outside the bar collapses the list.
  useEffect(() => {
    if (!isRecitersOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onRecitersOpenChange(false);
      }
    };
    const onPointer = (event: PointerEvent) => {
      const bar = barRef.current;
      if (bar && event.target instanceof Node && !bar.contains(event.target)) onRecitersOpenChange(false);
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [isRecitersOpen, onRecitersOpenChange]);

  return (
    <div
      ref={barRef}
      className={`audio-player${isRecitersOpen ? " is-expanded" : ""}`}
    >
      {/* Expands upward out of the bar: the reciters of this poem. */}
      <div
        className="audio-reciters"
        id="audio-reciters-panel"
        aria-hidden={!isRecitersOpen}
        inert={!isRecitersOpen}
      >
        <div className="audio-reciters-clip">
          <div className="audio-reciters-inner" dir="rtl">
            <div className="audio-reciters-header">
              <span className="audio-reciters-title">خوانش‌ها</span>
              <span className="audio-reciters-count">
                {toPersianDigits(poem.recitations?.length ?? 0)}
              </span>
            </div>
            <RecitationList
              recitations={poem.recitations ?? []}
              currentIndex={player.currentRecitationIndex}
              isPlaying={isPlaying}
              currentDuration={duration}
              onSelect={player.selectRecitation}
              poemTitle={poem.title}
              className="audio-reciters-list"
            />
          </div>
        </div>
      </div>
      <div className="audio-controls">
        <Button
          variant="ghost"
          size="icon"
          className="audio-control-button"
          onClick={player.handlePreviousRecitation}
          disabled={!player.hasPreviousRecitation}
          title="قطعه قبلی"
        >
          <FaBackward />
        </Button>
        <Button
          variant="default"
          size="icon"
          className="audio-control-button rounded-full"
          onClick={player.toggleAudio}
          disabled={!player.currentAudioSrc}
          title={isPlaying ? "توقف" : "پخش"}
        >
          {isAudioLoading ? (
            <FaSpinner className="animate-spin" />
          ) : isPlaying ? (
            <FaPause />
          ) : (
            <FaPlay />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="audio-control-button"
          onClick={player.handleNextRecitation}
          disabled={!player.hasNextRecitation}
          title="قطعه بعدی"
        >
          <FaForward />
        </Button>
        <Button
          variant={isHighlightEnabled ? "secondary" : "ghost"}
          size="icon"
          className={`audio-control-button ${isHighlightEnabled ? "active" : ""}`}
          onClick={onToggleHighlight}
          title={
            isHighlightEnabled
              ? "خاموش کردن برجسته‌سازی"
              : "روشن کردن برجسته‌سازی"
          }
        >
          {isHighlightEnabled ? <FaEye /> : <FaEyeSlash />}
        </Button>
      </div>

      <div className="audio-progress" onClick={player.handleProgressClick}>
        <div
          className="audio-progress-bar"
          style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
        />
      </div>

      <div className="audio-time">
        {formatTime(currentTime)} / {formatTime(duration)}
      </div>

      {/* Physically on the right (the bar is laid out LTR like a media player). */}
      <Button
        variant={isRecitersOpen ? "secondary" : "ghost"}
        size="icon"
        className="audio-control-button audio-reciters-toggle"
        onClick={() => onRecitersOpenChange(!isRecitersOpen)}
        aria-expanded={isRecitersOpen}
        aria-controls="audio-reciters-panel"
        title={isRecitersOpen ? "بستن فهرست خوانش‌ها" : "خوانش‌ها"}
      >
        <FaListUl aria-hidden="true" />
      </Button>

      <audio {...player.audioElementProps} />
    </div>
  );
}
