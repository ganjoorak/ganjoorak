"use client";

import React, { useEffect, useState } from "react";
import { FaBackward, FaEye, FaEyeSlash, FaForward, FaPause, FaPlay, FaSpinner } from "react-icons/fa";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerHeader, DrawerPanel, DrawerPopup, DrawerTitle } from "@/components/ui/drawer";
import { Slider } from "@/components/ui/slider";
import { useLongPress } from "@/hooks/useLongPress";
import RecitationList from "@/components/RecitationList";
import type { PoemRecitation } from "@/types/poem";

const HINT_KEY = "ganjoorak:player-hold-hint-seen";
const RING_RADIUS = 26;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

const toPersianDigits = (value: string) => value.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
const formatTime = (time: number) => {
  const safe = Number.isFinite(time) && time > 0 ? time : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  return toPersianDigits(`${minutes}:${seconds.toString().padStart(2, "0")}`);
};

type MobileAudioControlProps = {
  isPlaying: boolean;
  isLoading: boolean;
  canPlay: boolean;
  currentTime: number;
  duration: number;
  hasPrevious: boolean;
  hasNext: boolean;
  isHighlightEnabled: boolean;
  onToggle: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onToggleHighlight: () => void;
  onSeek: (time: number) => void;
  recitations: PoemRecitation[];
  currentRecitationIndex: number;
  onSelectRecitation: (index: number) => void;
  poemTitle?: string;
};

export default function MobileAudioControl({
  isPlaying,
  isLoading,
  canPlay,
  currentTime,
  duration,
  hasPrevious,
  hasNext,
  isHighlightEnabled,
  onToggle,
  onPrevious,
  onNext,
  onToggleHighlight,
  onSeek,
  recitations,
  currentRecitationIndex,
  onSelectRecitation,
  poemTitle,
}: MobileAudioControlProps) {
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [dragTime, setDragTime] = useState<number | null>(null);

  const [isHintLeaving, setIsHintLeaving] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(HINT_KEY)) return;
    } catch {
      return;
    }
    setShowHint(true);
    // Shown once: fade out after 3s or on the first scroll, whichever is first.
    const fadeOut = () => setIsHintLeaving(true);
    const timer = window.setTimeout(fadeOut, 3000);
    document.addEventListener("scroll", fadeOut, { capture: true, once: true });
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("scroll", fadeOut, { capture: true });
    };
  }, []);

  useEffect(() => {
    if (!isHintLeaving) return;
    const timer = window.setTimeout(() => dismissHint(), 300);
    return () => window.clearTimeout(timer);
  }, [isHintLeaving]);

  function dismissHint() {
    setShowHint(false);
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      // ignore storage errors
    }
  }

  const pressHandlers = useLongPress(() => {
    dismissHint();
    setIsSheetOpen(true);
  }, onToggle);

  const progress = duration > 0 ? Math.min(currentTime / duration, 1) : 0;
  const shownTime = dragTime ?? currentTime;
  const playIcon = isLoading ? <FaSpinner className="animate-spin" /> : isPlaying ? <FaPause /> : <FaPlay />;

  return (
    <div className="mobile-audio-control">
      {showHint && (
        <div
          className={`mobile-audio-hint${isHintLeaving ? " is-leaving" : ""}`}
          role="status"
          onClick={dismissHint}
        >
          برای کنترل‌های بیشتر نگه دار
        </div>
      )}
      <svg className="mobile-audio-ring" viewBox="0 0 56 56" aria-hidden="true">
        <circle cx="28" cy="28" r={RING_RADIUS} className="mobile-audio-ring-track" />
        <circle
          cx="28"
          cy="28"
          r={RING_RADIUS}
          className="mobile-audio-ring-progress"
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH * (1 - progress)}
        />
      </svg>
      <Button
        variant="default"
        size="icon"
        className="mobile-audio-button rounded-full"
        disabled={!canPlay}
        aria-label={isPlaying ? "توقف (برای کنترل‌های بیشتر نگه دارید)" : "پخش (برای کنترل‌های بیشتر نگه دارید)"}
        {...pressHandlers}
      >
        {playIcon}
      </Button>

      <Drawer open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <DrawerPopup dir="rtl" showBar className="mobile-audio-sheet">
          <DrawerHeader className="pb-2">
            <DrawerTitle>پخش خوانش</DrawerTitle>
          </DrawerHeader>
          <DrawerPanel className="flex flex-col gap-5">
            <div dir="ltr" className="flex flex-col gap-2">
              <Slider
                aria-label="پیشرفت پخش"
                min={0}
                max={duration > 0 ? duration : 1}
                step={0.1}
                disabled={!duration}
                value={[Math.min(shownTime, duration || 0)]}
                onValueChange={(value) => setDragTime(Array.isArray(value) ? value[0] : value)}
                onValueCommitted={(value) => {
                  onSeek(Array.isArray(value) ? value[0] : value);
                  setDragTime(null);
                }}
              />
              <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                <span>{formatTime(shownTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>
            <div dir="ltr" className="flex items-center justify-center gap-3">
              <Button variant="ghost" size="icon" className="size-11" onClick={onPrevious} disabled={!hasPrevious} title="قطعه قبلی">
                <FaBackward />
              </Button>
              <Button variant="default" size="icon" className="size-12 rounded-full" onClick={onToggle} disabled={!canPlay} title={isPlaying ? "توقف" : "پخش"}>
                {playIcon}
              </Button>
              <Button variant="ghost" size="icon" className="size-11" onClick={onNext} disabled={!hasNext} title="قطعه بعدی">
                <FaForward />
              </Button>
              <Button
                variant={isHighlightEnabled ? "secondary" : "ghost"}
                size="icon"
                className="size-11"
                onClick={onToggleHighlight}
                title={isHighlightEnabled ? "خاموش کردن برجسته‌سازی" : "روشن کردن برجسته‌سازی"}
              >
                {isHighlightEnabled ? <FaEye /> : <FaEyeSlash />}
              </Button>
            </div>
            <section className="mobile-audio-reciters" aria-label="خوانش‌ها">
              <div className="audio-reciters-header">
                <span className="audio-reciters-title">خوانش‌ها</span>
                <span className="audio-reciters-count">{toPersianDigits(String(recitations.length))}</span>
              </div>
              <RecitationList
                recitations={recitations}
                currentIndex={currentRecitationIndex}
                isPlaying={isPlaying}
                currentDuration={duration}
                onSelect={onSelectRecitation}
                poemTitle={poemTitle}
              />
            </section>
          </DrawerPanel>
        </DrawerPopup>
      </Drawer>
    </div>
  );
}
