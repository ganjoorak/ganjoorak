"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Poem } from "@/types/poem";
import { logger } from "@/utils/logger";
import { createPoemOrder } from "@/components/poet-page/poetPageUtils";

interface PoemSequenceOptions {
  /** Shown when a poem cannot be loaded. */
  loadError: string;
  /** Names the source in logs. */
  label: string;
}

/**
 * A poet page's reading order: which poems, in what order, the one on screen, and its neighbours preloaded.
 * `fetchPoem` must be stable (useCallback); loaded poems are cached until `reset`.
 */
export function usePoemSequence(
  fetchPoem: (poemId: number) => Promise<Poem>,
  { loadError, label }: PoemSequenceOptions,
) {
  const [order, setOrderState] = useState<number[]>([]);
  // Read by callbacks that run before the next render.
  const orderRef = useRef<number[]>([]);
  const [index, setIndex] = useState(0);
  const [poem, setPoem] = useState<Poem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<Record<number, Poem>>({});

  const setOrder = useCallback((next: number[]) => {
    orderRef.current = next;
    setOrderState(next);
  }, []);

  /** No poem on screen and nothing to read. */
  const clear = useCallback(() => {
    setOrder([]);
    setPoem(null);
    setIndex(0);
  }, [setOrder]);

  /** As `clear`, and forget loaded poems (another poet). */
  const reset = useCallback(() => {
    clear();
    setError(null);
    cacheRef.current = {};
  }, [clear]);

  /** Keep a poem loaded elsewhere, so the sequence need not fetch it again. */
  const remember = useCallback((loaded: Poem) => {
    cacheRef.current[loaded.id] = loaded;
  }, []);

  const getPoem = useCallback(
    async (poemId: number) => {
      if (cacheRef.current[poemId]) {
        return cacheRef.current[poemId];
      }
      const loaded = await fetchPoem(poemId);
      cacheRef.current[poemId] = loaded;
      return loaded;
    },
    [fetchPoem],
  );

  const loadAt = useCallback(
    async (target: number, orderOverride?: number[]) => {
      const current = orderOverride ?? orderRef.current;
      if (!current.length || target < 0 || target >= current.length) {
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const loaded = await getPoem(current[target]);
        setPoem(loaded);
        setIndex(target);
      } catch (err) {
        logger.error(`Error loading ${label} poem:`, err);
        setError(loadError);
      } finally {
        setLoading(false);
      }
    },
    [getPoem, label, loadError],
  );

  /** Read `next` from `start`. */
  const play = useCallback(
    (next: number[], start = 0) => {
      setOrder(next);
      return loadAt(start, next);
    },
    [loadAt, setOrder],
  );

  // Preload both neighbours, so moving either way is instant.
  useEffect(() => {
    if (!poem) return;
    const current = orderRef.current;
    if (!current.length) return;

    [index + 1, index - 1].forEach((neighbour) => {
      const poemId = current[neighbour];
      if (!poemId || cacheRef.current[poemId]) return;
      getPoem(poemId).catch((err) => {
        logger.error(`Error preloading ${label} poem:`, err);
      });
    });
  }, [poem, index, getPoem, label, order]);

  /** At the end, a shuffled order starts over when `reshuffle`; otherwise the last poem stays. */
  const goNext = useCallback(
    (reshuffle: boolean) => {
      const current = orderRef.current;
      if (!current.length) return;
      if (index + 1 < current.length) {
        loadAt(index + 1);
      } else if (reshuffle) {
        play(createPoemOrder(current, true));
      }
    },
    [index, loadAt, play],
  );

  const goPrevious = useCallback(() => {
    if (orderRef.current.length && index > 0) {
      loadAt(index - 1);
    }
  }, [index, loadAt]);

  const retry = useCallback(() => {
    loadAt(index);
  }, [index, loadAt]);

  /** Show an already-loaded poem as the only one in the order. */
  const showOnly = useCallback(
    (loaded: Poem) => {
      cacheRef.current[loaded.id] = loaded;
      setOrder([loaded.id]);
      setError(null);
      setPoem(loaded);
      setIndex(0);
    },
    [setOrder],
  );

  const nextPoemId = order[index + 1];

  return {
    order,
    orderRef,
    index,
    poem,
    loading,
    setLoading,
    error,
    setError,
    /** The poem after this one, once preloaded. */
    nextPoem: nextPoemId ? cacheRef.current[nextPoemId] : undefined,
    isAtEnd: order.length === 0 || index >= order.length - 1,
    setOrder,
    clear,
    reset,
    remember,
    loadAt,
    play,
    goNext,
    goPrevious,
    retry,
    showOnly,
  };
}
