"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ganjoorApi from "@/api/GanjoorApi";
import type { PoemRecitation, VerseSync } from "@/types/poem";
import { logger } from "@/utils/logger";
import {
  ensureShareFonts,
  type ShareCardInput,
  type ShareCardLayoutResult,
} from "@/components/share/shareCard";
import {
  buildShareTimeline,
  loadRecitationAudio,
  recordShareVideo,
} from "@/components/share/shareVideo";
import type { VideoState } from "@/components/share/shareDialog";

interface ShareVideoOptions {
  isOpen: boolean;
  layout: ShareCardLayoutResult | null;
  cardInput: ShareCardInput;
  fontStack: string;
  /** The reciter whose voice the video carries; none for a silent video. */
  recitation: PoemRecitation | undefined;
  recitationIndex: number;
  selectedLines: Array<{ index: number; text: string }>;
}

/** The share video: its recording state, and the timeline that times the lines to the chosen recitation. */
export function useShareVideo({
  isOpen,
  layout,
  cardInput,
  fontStack,
  recitation,
  recitationIndex,
  selectedLines,
}: ShareVideoOptions) {
  const [video, setVideo] = useState<VideoState>({ status: "idle" });
  const [verseSync, setVerseSync] = useState<VerseSync[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // A finished video no longer matches once anything about it changes.
  useEffect(() => {
    abortRef.current?.abort();
    setVideo((current) => {
      if (current.status === "done") URL.revokeObjectURL(current.url);
      return { status: "idle" };
    });
  }, [cardInput, recitationIndex]);

  useEffect(() => {
    if (!isOpen) abortRef.current?.abort();
  }, [isOpen]);

  // Verse timings for the chosen recitation, so lines appear as recited.
  useEffect(() => {
    setVerseSync(null);
    if (!recitation?.inSyncWithText) return;
    let cancelled = false;
    ganjoorApi
      .getRecitationVerses(recitation.id)
      .then((data) => !cancelled && setVerseSync(data))
      .catch((error) => logger.error("Error fetching verse sync:", error));
    return () => {
      cancelled = true;
    };
  }, [recitation]);

  const syncFor = useCallback(
    (shown: ShareCardLayoutResult, audioSeconds?: number) => {
      if (!verseSync?.length || !recitation) return null;
      const visible = selectedLines.slice(0, shown.lineGroups.length);
      const starts = visible.map(
        (line) => verseSync.find((v) => v.verseOrder === line.index + 1)?.audioStartMilliseconds,
      );
      if (!starts.length || starts.some((s) => s === undefined)) return null;
      const last = visible[visible.length - 1];
      const nextStart = verseSync.find((v) => v.verseOrder === last.index + 2)?.audioStartMilliseconds;
      const lastStart = starts[starts.length - 1] as number;
      const endMs =
        nextStart ?? (audioSeconds ? audioSeconds * 1000 : lastStart + 4500);
      return { starts: starts as number[], endMs };
    },
    [recitation, selectedLines, verseSync],
  );

  const previewTimeline = useMemo(
    () => (layout ? buildShareTimeline(layout, syncFor(layout)) : null),
    [layout, syncFor],
  );

  const generateVideo = async () => {
    if (!layout) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    try {
      let audio: AudioBuffer | null = null;
      if (recitation) {
        setVideo({ status: "preparing", label: "دریافت صدای خوانش…" });
        try {
          audio = await loadRecitationAudio(recitation.mp3Url, signal);
        } catch (error) {
          if (signal.aborted) throw error;
          logger.error("Recitation audio unavailable:", error);
        }
      }
      setVideo({ status: "preparing", label: "آماده‌سازی…" });
      await ensureShareFonts(fontStack);
      const timeline = buildShareTimeline(layout, audio ? syncFor(layout, audio.duration) : null);
      setVideo({ status: "recording", progress: 0 });
      const result = await recordShareVideo({
        layout,
        timeline,
        audio,
        signal,
        onProgress: (progress) => setVideo({ status: "recording", progress }),
      });
      if (signal.aborted) return;
      setVideo({ status: "done", result, url: URL.createObjectURL(result.blob) });
    } catch (error) {
      if ((error as DOMException)?.name === "AbortError" || signal.aborted) {
        setVideo({ status: "idle" });
        return;
      }
      logger.error("Video export failed:", error);
      setVideo({ status: "error", message: "ساخت ویدیو ممکن نشد. دوباره امتحان کنید." });
    }
  };

  const resetVideo = useCallback(() => setVideo({ status: "idle" }), []);

  const cancelVideo = () => {
    abortRef.current?.abort();
    resetVideo();
  };

  const busy = video.status === "preparing" || video.status === "recording";
  const progress =
    video.status === "recording" ? video.progress : video.status === "preparing" ? 0 : 1;

  return {
    video,
    previewTimeline,
    generateVideo,
    cancelVideo,
    resetVideo,
    busy,
    progress,
  };
}
