"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminPage } from "@/utils/adminApi";

/**
 * A paged list. It starts over whenever `queryKey` changes; an answer that was
 * overtaken by a newer query is dropped.
 */
export function useAdminList<T extends { id: number }>(
  queryKey: string,
  load: (before?: number) => Promise<AdminPage<T>>,
) {
  const [items, setItems] = useState<T[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const loadRef = useRef(load);
  loadRef.current = load;
  const latest = useRef(0);

  const fetchPage = useCallback(async (before?: number) => {
    const request = ++latest.current;
    setIsLoading(true);
    setError("");
    try {
      const page = await loadRef.current(before);
      if (request !== latest.current) return;
      setItems((current) => (before ? [...current, ...page.items] : page.items));
      setNext(page.next);
    } catch (reason) {
      if (request === latest.current) setError(reason instanceof Error ? reason.message : "");
    } finally {
      if (request === latest.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPage();
  }, [fetchPage, queryKey]);

  const removeItem = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  return {
    items,
    next,
    isLoading,
    error,
    removeItem,
    reload: useCallback(() => void fetchPage(), [fetchPage]),
    loadMore: useCallback(() => {
      if (next !== null) void fetchPage(next);
    }, [fetchPage, next]),
  };
}
