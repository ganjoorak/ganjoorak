"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PoemHit } from "@/utils/searchMatch";
import {
  fetchSearch,
  ganjoorSearchUrl,
  localSearchUrl,
  peekSearch,
  type GanjoorSearchResponse,
  type LocalSearchResponse,
} from "@/utils/searchClient";
import { MIN_SEARCH_QUERY_LENGTH, normalizeSearchText } from "@/utils/searchText";
import { logger } from "@/utils/logger";

export type SearchStatus = "idle" | "loading" | "done" | "error";

export interface LocalResults {
  status: SearchStatus;
  hits: PoemHit[];
  total: number;
  counts: Record<"custom" | "echolalia", number>;
}

export interface GanjoorResults {
  status: SearchStatus;
  hits: PoemHit[];
  /** How many hits came with the first response (merged with local hits by quality). */
  firstPage: number;
  next: string | null;
  phraseTotal: number | null;
  wordsTotal: number | null;
  loadingMore: boolean;
  loadMoreError: boolean;
}

export interface PoemSearchOptions {
  term: string;
  /** Local mirror: Echolalia + bundled poets. */
  local: boolean;
  localSource?: "custom" | "echolalia" | null;
  localPoet?: string | null;
  localLimit?: number;
  ganjoor: boolean;
  ganjoorPoetId?: number | null;
}

const LOCAL_DELAY_MS = 60;
const GANJOOR_DELAY_MS = 220;

const idleLocal: LocalResults = { status: "idle", hits: [], total: 0, counts: { custom: 0, echolalia: 0 } };
const idleGanjoor: GanjoorResults = {
  status: "idle",
  hits: [],
  firstPage: 0,
  next: null,
  phraseTotal: null,
  wordsTotal: null,
  loadingMore: false,
  loadMoreError: false,
};

// Ganjoor pages the user already scrolled through, so coming back from a poem restores the list.
const loadedGanjoor = new Map<string, GanjoorResults>();

const fromFirstPage = (page: GanjoorSearchResponse): GanjoorResults => ({
  ...idleGanjoor,
  status: "done",
  hits: page.hits,
  firstPage: page.hits.length,
  next: page.next,
  phraseTotal: page.phraseTotal,
  wordsTotal: page.wordsTotal,
});

/**
 * Search-as-you-type over the local mirror (instant) and Ganjoor (slower, paged). Cached queries
 * resolve in the same render; otherwise the previous results stay on screen until new ones land.
 */
export function usePoemSearch(options: PoemSearchOptions) {
  const { term, local, localSource, localPoet, localLimit = 30, ganjoor, ganjoorPoetId } = options;
  const enabled = normalizeSearchText(term).length >= MIN_SEARCH_QUERY_LENGTH;
  const localUrl = enabled && local
    ? localSearchUrl(term, { poet: localPoet, source: localSource, limit: localLimit })
    : null;
  const ganjoorUrl = enabled && ganjoor ? ganjoorSearchUrl(term, { poetId: ganjoorPoetId }) : null;

  const [localResults, setLocalResults] = useState<LocalResults>(() => {
    const cached = localUrl ? peekSearch<LocalSearchResponse>(localUrl) : undefined;
    return cached ? { status: "done", ...cached } : idleLocal;
  });
  const [ganjoorResults, setGanjoorResults] = useState<GanjoorResults>(() => {
    if (!ganjoorUrl) return idleGanjoor;
    const loaded = loadedGanjoor.get(ganjoorUrl);
    const cached = peekSearch<GanjoorSearchResponse>(ganjoorUrl);
    return loaded ?? (cached ? fromFirstPage(cached) : idleGanjoor);
  });
  const [retryToken, setRetryToken] = useState(0);
  const ganjoorUrlRef = useRef(ganjoorUrl);
  ganjoorUrlRef.current = ganjoorUrl;
  const ganjoorRef = useRef(ganjoorResults);
  ganjoorRef.current = ganjoorResults;

  useEffect(() => {
    if (!localUrl) {
      setLocalResults(idleLocal);
      return;
    }
    const cached = peekSearch<LocalSearchResponse>(localUrl);
    if (cached) {
      setLocalResults({ status: "done", ...cached });
      return;
    }
    let current = true;
    setLocalResults((previous) => ({ ...previous, status: "loading" }));
    const timer = window.setTimeout(() => {
      fetchSearch<LocalSearchResponse>(localUrl)
        .then((data) => current && setLocalResults({ status: "done", ...data }))
        .catch((error) => {
          logger.warn("Local search failed:", error);
          if (current) setLocalResults({ ...idleLocal, status: "error" });
        });
    }, LOCAL_DELAY_MS);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [localUrl, retryToken]);

  useEffect(() => {
    if (!ganjoorUrl) {
      setGanjoorResults(idleGanjoor);
      return;
    }
    const loaded = loadedGanjoor.get(ganjoorUrl);
    const cached = peekSearch<GanjoorSearchResponse>(ganjoorUrl);
    if (loaded || cached) {
      setGanjoorResults(loaded ?? fromFirstPage(cached!));
      return;
    }
    let current = true;
    setGanjoorResults((previous) => ({ ...previous, status: "loading", loadingMore: false }));
    const timer = window.setTimeout(() => {
      fetchSearch<GanjoorSearchResponse>(ganjoorUrl)
        .then((data) => current && setGanjoorResults(fromFirstPage(data)))
        .catch((error) => {
          logger.warn("Ganjoor search failed:", error);
          if (current) setGanjoorResults({ ...idleGanjoor, status: "error" });
        });
    }, GANJOOR_DELAY_MS);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [ganjoorUrl, retryToken]);

  const loadMore = useCallback(() => {
    const state = ganjoorRef.current;
    const baseUrl = ganjoorUrlRef.current;
    if (!baseUrl || state.status !== "done" || !state.next || state.loadingMore) {
      return;
    }
    const pageUrl = `${baseUrl}&cursor=${encodeURIComponent(state.next)}`;
    setGanjoorResults((previous) => ({ ...previous, loadingMore: true, loadMoreError: false }));
    fetchSearch<GanjoorSearchResponse>(pageUrl)
      .then((page) => {
        if (ganjoorUrlRef.current !== baseUrl) return;
        setGanjoorResults((previous) => {
          const seen = new Set(previous.hits.map((hit) => hit.key));
          const next: GanjoorResults = {
            ...previous,
            hits: [...previous.hits, ...page.hits.filter((hit) => !seen.has(hit.key))],
            next: page.next,
            phraseTotal: previous.phraseTotal ?? page.phraseTotal,
            wordsTotal: page.wordsTotal ?? previous.wordsTotal,
            loadingMore: false,
          };
          loadedGanjoor.set(baseUrl, next);
          return next;
        });
      })
      .catch((error) => {
        logger.warn("Loading more Ganjoor results failed:", error);
        if (ganjoorUrlRef.current === baseUrl) {
          setGanjoorResults((previous) => ({ ...previous, loadingMore: false, loadMoreError: true }));
        }
      });
  }, []);

  // Fetch the next page in the background as soon as one is on screen.
  useEffect(() => {
    if (ganjoorUrl && ganjoorResults.status === "done" && ganjoorResults.next) {
      fetchSearch(`${ganjoorUrl}&cursor=${encodeURIComponent(ganjoorResults.next)}`).catch(() => undefined);
    }
  }, [ganjoorResults.next, ganjoorResults.status, ganjoorUrl]);

  const retry = useCallback(() => setRetryToken((token) => token + 1), []);

  return {
    enabled,
    local: localUrl ? localResults : idleLocal,
    ganjoor: ganjoorUrl ? ganjoorResults : idleGanjoor,
    loadMore,
    retry,
  };
}
