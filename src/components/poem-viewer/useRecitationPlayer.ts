"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import type { Poem } from "@/types/poem";
import { logger } from "@/utils/logger";

/** Playback of a poem's recitations: one <audio> element, the current reciter and its progress. */
export function useRecitationPlayer(poem: Poem) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [currentRecitationIndex, setCurrentRecitationIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const playAfterSwitchRef = useRef(false);

  const recitationCount = poem.recitations?.length ?? 0;
  const currentRecitation = poem.recitations?.[currentRecitationIndex];
  const currentAudioSrc =
    currentRecitation?.mp3Url ||
    currentRecitation?.audioSrc ||
    currentRecitation?.audioSrcUrl ||
    "";

  /** Before leaving the poem: stop and rewind to the first reciter. */
  const stop = useCallback(() => {
    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
    setCurrentTime(0);
    setDuration(0);
    setCurrentRecitationIndex(0);
  }, [isPlaying]);

  const toggleAudio = () => {
    if (!audioRef.current || !currentAudioSrc) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      setIsAudioLoading(true);
      audioRef.current
        .play()
        .then(() => {
          setIsPlaying(true);
        })
        .catch((err) => {
          logger.error("Error playing audio:", err);
          setIsPlaying(false);
        })
        .finally(() => {
          setIsAudioLoading(false);
        });
    }
  };

  const switchRecitation = (index: number) => {
    const wasPlaying = isPlaying;
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
    setCurrentRecitationIndex(index);
    setCurrentTime(0);
    if (wasPlaying) {
      const playWhenReady = () => {
        if (audioRef.current) {
          audioRef.current
            .play()
            .then(() => {
              setIsPlaying(true);
            })
            .catch((err) => {
              logger.error("Error playing audio:", err);
              setIsPlaying(false);
            });
        }
      };
      if (audioRef.current) {
        audioRef.current.addEventListener("loadeddata", playWhenReady, {
          once: true,
        });
      }
    }
  };

  const hasNextRecitation = currentRecitationIndex < recitationCount - 1;
  const hasPreviousRecitation = recitationCount > 0 && currentRecitationIndex > 0;

  const handleNextRecitation = () => {
    if (!hasNextRecitation) return;
    switchRecitation(currentRecitationIndex + 1);
  };

  const handlePreviousRecitation = () => {
    if (!hasPreviousRecitation) return;
    switchRecitation(currentRecitationIndex - 1);
  };

  /** Pick a reciter from the list: switch to it and play (tapping the loaded one toggles play/pause). */
  const selectRecitation = (index: number) => {
    if (index < 0 || index >= recitationCount) return;
    if (index === currentRecitationIndex) {
      toggleAudio();
      return;
    }
    if (audioRef.current) audioRef.current.pause();
    setIsPlaying(false);
    playAfterSwitchRef.current = true;
    setCurrentRecitationIndex(index);
    setCurrentTime(0);
    setDuration(0);
  };

  // After a switch from the list, start the new recitation once its src is in the DOM.
  useEffect(() => {
    if (!playAfterSwitchRef.current) return;
    playAfterSwitchRef.current = false;
    const audio = audioRef.current;
    if (!audio || !currentAudioSrc) return;
    setIsAudioLoading(true);
    audio
      .play()
      .then(() => {
        setIsPlaying(true);
      })
      .catch((err) => {
        logger.error("Error playing audio:", err);
        setIsPlaying(false);
      })
      .finally(() => setIsAudioLoading(false));
  }, [currentAudioSrc]);

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration || isAudioLoading) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const newTime = ((e.clientX - rect.left) / rect.width) * duration;

    // Set loading state while seeking
    setIsAudioLoading(true);

    try {
      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    } catch (error) {
      logger.error("Error seeking audio:", error);
      if (audioRef.current) {
        setCurrentTime(audioRef.current.currentTime);
      }
    } finally {
      setIsAudioLoading(false);
    }
  };

  const handleSeek = (time: number) => {
    if (!audioRef.current || !duration) return;
    try {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    } catch (error) {
      logger.error("Error seeking audio:", error);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    if (hasNextRecitation) {
      handleNextRecitation();
      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current
            .play()
            .then(() => {
              setIsPlaying(true);
            })
            .catch((error) => {
              logger.error("Error playing next audio:", error);
              setIsPlaying(false);
            });
        }
      }, 500);
    }
  };

  // Auto-play first recitation when poem changes
  useEffect(() => {
    // Reset audio states
    setCurrentTime(0);
    setDuration(0);

    // Only reset if there are no recitations in the new poem
    if (!poem.recitations || poem.recitations.length === 0) {
      setIsPlaying(false);
      setCurrentRecitationIndex(0);
    } else {
      // Keep the current recitation index if possible
      const maxIndex = poem.recitations.length - 1;
      if (currentRecitationIndex > maxIndex) {
        setCurrentRecitationIndex(0);
      }
    }

    // Try to play the first recitation if available and was playing before
    if (poem.recitations?.length > 0 && audioRef.current && isPlaying) {
      setIsAudioLoading(true);
      audioRef.current
        .play()
        .then(() => {
          setIsPlaying(true);
        })
        .catch((error) => {
          logger.error("Error auto-playing audio:", error);
          setIsPlaying(false);
        })
        .finally(() => {
          setIsAudioLoading(false);
        });
    }
  }, [poem.id]);

  // Reset playback state when audio source changes
  useEffect(() => {
    setIsAudioLoading(false);
    setCurrentTime(0);
    setDuration(0);
  }, [currentAudioSrc]);

  /** Spread onto the one <audio> element. */
  const audioElementProps: React.AudioHTMLAttributes<HTMLAudioElement> & {
    ref: React.RefObject<HTMLAudioElement>;
  } = {
    ref: audioRef,
    src: currentAudioSrc,
    preload: "none",
    onTimeUpdate: () => {
      if (audioRef.current) {
        setCurrentTime(audioRef.current.currentTime);
      }
    },
    onLoadedMetadata: () => {
      if (audioRef.current) {
        setDuration(audioRef.current.duration);
        setIsAudioLoading(false);
      }
    },
    onLoadStart: () => {
      if (isPlaying) {
        setIsAudioLoading(true);
      }
    },
    onCanPlayThrough: () => setIsAudioLoading(false),
    onSeeking: () => setIsAudioLoading(true),
    onSeeked: () => setIsAudioLoading(false),
    onWaiting: () => {
      if (isPlaying) {
        setIsAudioLoading(true);
      }
    },
    onPlaying: () => setIsAudioLoading(false),
    onEnded: handleEnded,
    onError: (e) => {
      logger.error("Audio error:", e.currentTarget.error || e);
      setIsAudioLoading(false);
      setIsPlaying(false);
    },
  };

  return {
    isPlaying,
    isAudioLoading,
    currentRecitationIndex,
    currentTime,
    duration,
    currentAudioSrc,
    hasNextRecitation,
    hasPreviousRecitation,
    stop,
    toggleAudio,
    handleNextRecitation,
    handlePreviousRecitation,
    selectRecitation,
    handleProgressClick,
    handleSeek,
    audioElementProps,
  };
}

export type RecitationPlayer = ReturnType<typeof useRecitationPlayer>;
