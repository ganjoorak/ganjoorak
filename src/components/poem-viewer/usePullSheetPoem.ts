"use client";

import { useEffect, useRef, useState } from "react";
import type { Poem } from "@/types/poem";
import { useStackedMesras } from "@/components/poem-viewer/useStackedMesras";

/**
 * What one pull sheet (next or previous) shows. Once a pull commits, the sheet keeps showing the poem it
 * committed to while the real poem lands under it, even though the page has already computed a new
 * neighbour for the poem that just landed. Each sheet also measures its own poem's mesra layout, so a
 * poem never changes layout when it lands.
 */
export function usePullSheetPoem(peek: Poem | null | undefined, livePoemId: number | string) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetTextRef = useRef<HTMLDivElement>(null);
  const [committed, setCommitted] = useState<Poem | null>(null);
  useEffect(() => {
    if (!committed) return;
    const timer = window.setTimeout(() => setCommitted(null), committed.id === livePoemId ? 400 : 7000);
    return () => window.clearTimeout(timer);
  }, [committed, livePoemId]);
  const sheetPoem = committed ?? peek ?? null;
  const isStacked = useStackedMesras(sheetTextRef, sheetPoem?.id ?? "");
  return { sheetRef, sheetTextRef, sheetPoem, isStacked, setCommitted, isCommitted: committed !== null };
}
