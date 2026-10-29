"use client";

import type React from "react";
import type { RefObject } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Pause, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  SHARE_CARD_FORMATS,
  type ShareCardFormat,
  type ShareCardLayoutResult,
} from "@/components/share/shareCard";
import { faNumber, type ShareMode, type VideoState } from "@/components/share/shareDialog";

interface SharePreviewProps {
  mode: ShareMode;
  format: ShareCardFormat;
  video: VideoState;
  /** The finished video replaces the live canvas. */
  showVideoResult: boolean;
  previewRef: RefObject<HTMLCanvasElement>;
  layout: ShareCardLayoutResult | null;
  hasSelectedLines: boolean;
  previewPlaying: boolean;
  reduceMotion: boolean | null;
  onTogglePreview: () => void;
  /** Preparing or recording a video. */
  busy: boolean;
  progress: number;
  onCancel: () => void;
}

/** The card as it will be shared (canvas), or the finished video, with video progress over it. */
export default function SharePreview({
  mode,
  format,
  video,
  showVideoResult,
  previewRef,
  layout,
  hasSelectedLines,
  previewPlaying,
  reduceMotion,
  onTogglePreview,
  busy,
  progress,
  onCancel,
}: SharePreviewProps) {
  const { width: cardW, height: cardH } = SHARE_CARD_FORMATS[format];

  return (
    <>
      <div className="share-stage">
        <div
          className="share-preview"
          style={
            { "--ratio": cardW / cardH } as React.CSSProperties
          }
        >
          <AnimatePresence initial={false}>
            {showVideoResult && video.status === "done" ? (
              <motion.video
                key="video"
                className="share-preview__media"
                src={video.url}
                controls
                playsInline
                autoPlay
                loop
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            ) : (
              <motion.canvas
                key="canvas"
                ref={previewRef}
                className="share-preview__media"
                role="img"
                aria-label="پیش‌نمایش کارت شعر"
                initial={{ opacity: 0 }}
                animate={{ opacity: layout ? 1 : 0 }}
                exit={{ opacity: 0 }}
              />
            )}
          </AnimatePresence>

          {!layout && !hasSelectedLines && (
            <p className="share-preview__empty">مصرعی انتخاب نشده</p>
          )}

          {mode === "video" && !showVideoResult && !busy && layout && (
            <button
              type="button"
              className="share-preview__play"
              onClick={onTogglePreview}
              aria-label={previewPlaying && !reduceMotion ? "توقف پیش‌نمایش" : "پخش پیش‌نمایش"}
            >
              {previewPlaying && !reduceMotion ? <Pause /> : <Play />}
            </button>
          )}

          <AnimatePresence>
            {busy && (
              <motion.div
                className="share-progress"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="share-progress__ring" style={{ "--p": progress } as React.CSSProperties}>
                  <span>{faNumber.format(Math.round(progress * 100))}٪</span>
                </div>
                <p>{video.status === "preparing" ? video.label : "در حال ساخت ویدیو…"}</p>
                <Button variant="secondary" className="share-progress__cancel" onClick={onCancel}>
                  <X /> لغو
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {(layout?.truncated || video.status === "error") && (
          <motion.p
            className="share-note"
            data-error={video.status === "error" || undefined}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            {video.status === "error" ? video.message : "همه‌ی مصرع‌ها در کارت جا نشدند."}
          </motion.p>
        )}
      </AnimatePresence>
    </>
  );
}
