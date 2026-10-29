"use client";

import { useCallback, useEffect, useState } from "react";
import { LIBRARY_CHANGE_EVENT } from "@/utils/poemLibrary";
import {
  readLovedCollections,
  toggleLovedCollection,
  type CollectionEntry,
} from "@/utils/collectionLibrary";

/** The reader's loved books, kept fresh across the sync, other tabs and other components. */
export function useLovedCollections() {
  const [collections, setCollections] = useState<CollectionEntry[]>([]);

  useEffect(() => {
    const refresh = () => setCollections(readLovedCollections());
    refresh();
    window.addEventListener(LIBRARY_CHANGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(LIBRARY_CHANGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const isLoved = useCallback(
    (key: string) => collections.some((entry) => entry.key === key),
    [collections],
  );
  const toggle = useCallback(
    (entry: Omit<CollectionEntry, "savedAt">) => toggleLovedCollection(entry),
    [],
  );

  return { collections, isLoved, toggle };
}
