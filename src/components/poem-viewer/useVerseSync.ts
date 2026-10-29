"use client";

import { useEffect, useState } from "react";
import ganjoorApi from "@/api/GanjoorApi";
import type { Poem, VerseSync } from "@/types/poem";
import { logger } from "@/utils/logger";

/**
 * The verse being recited, for recitations Ganjoor has synced with the text.
 * Returns the 1-based verse order, or -1 when nothing should be highlighted.
 */
export function useVerseSync(
  poem: Poem,
  recitationIndex: number,
  currentTime: number,
  isPlaying: boolean,
) {
  const [verseSync, setVerseSync] = useState<VerseSync[]>([]);
  const [currentHighlightedVerse, setCurrentHighlightedVerse] =
    useState<number>(-1);

  // Reset verse sync data when poem changes
  useEffect(() => {
    setVerseSync([]);
    setCurrentHighlightedVerse(-1);
  }, [poem.id, poem.recitations]);

  // Fetch verse synchronization data when recitation changes
  useEffect(() => {
    const fetchVerseSync = async () => {
      if (!poem.recitations || poem.recitations.length === 0) {
        setVerseSync([]);
        return;
      }

      const currentRecitation = poem.recitations[recitationIndex];
      if (!currentRecitation || !currentRecitation.inSyncWithText) {
        setVerseSync([]);
        setCurrentHighlightedVerse(-1);
        return;
      }

      try {
        const verseSyncData = await ganjoorApi.getRecitationVerses(
          currentRecitation.id,
        );
        setVerseSync(verseSyncData);
        // Immediately set to highlight first verse (order 1) when sync data loads
        const firstVerse = verseSyncData.find((v) => v.verseOrder === 1);
        setCurrentHighlightedVerse(firstVerse ? 1 : -1);
      } catch (error) {
        logger.error("Error fetching verse sync data:", error);
        setVerseSync([]);
        setCurrentHighlightedVerse(-1);
      }
    };

    fetchVerseSync();
  }, [poem.recitations, recitationIndex]);

  // Update highlighted verse based on current audio time
  useEffect(() => {
    if (!verseSync.length) {
      return;
    }

    if (!isPlaying) {
      setCurrentHighlightedVerse(-1);
      return;
    }

    const currentTimeMs = currentTime * 1000;
    let highlightedVerseIndex = -1;

    // At the very beginning (0-2000ms), always start with verse order 1
    if (currentTimeMs <= 2000) {
      highlightedVerseIndex = 1;
    } else {
      // The verse that started last before the current time
      for (let i = 0; i < verseSync.length; i++) {
        const verse = verseSync[i];
        const nextVerse = verseSync[i + 1];
        if (
          currentTimeMs >= verse.audioStartMilliseconds &&
          (!nextVerse || currentTimeMs < nextVerse.audioStartMilliseconds)
        ) {
          highlightedVerseIndex = verse.verseOrder;
          break;
        }
      }
    }

    // Fallback to the very first verse
    if (highlightedVerseIndex === -1) {
      const firstVerse =
        verseSync.find((v) => v.verseOrder === 1) || verseSync[0];
      if (firstVerse) {
        highlightedVerseIndex = firstVerse.verseOrder;
      }
    }

    if (highlightedVerseIndex !== currentHighlightedVerse) {
      setCurrentHighlightedVerse(highlightedVerseIndex);
    }
  }, [currentTime, verseSync, isPlaying, currentHighlightedVerse]);

  return {
    hasVerseSync: verseSync.length > 0,
    currentHighlightedVerse,
  };
}
