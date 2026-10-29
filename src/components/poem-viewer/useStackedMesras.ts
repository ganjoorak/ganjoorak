"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Mesras sit side by side and never wrap; on tablet-width screens a long couplet can be wider than the
 * poem column. Stack the mesras (as on phones) only for poems whose widest couplet doesn't fit.
 */
export function useStackedMesras(poemTextRef: RefObject<HTMLDivElement | null>, poemId: number | string) {
  const [isStacked, setIsStacked] = useState(false);

  useLayoutEffect(() => {
    const poemText = poemTextRef.current;
    if (!poemText) return;

    const measure = () => {
      // Test the side-by-side layout without painting it: drop the class, read, restore.
      const wasStacked = poemText.classList.contains("poem-text--stacked");
      poemText.classList.remove("poem-text--stacked");
      const overflows = poemText.scrollWidth > poemText.clientWidth + 1;
      if (wasStacked) poemText.classList.add("poem-text--stacked");
      setIsStacked(overflows);
    };

    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(poemText);
    // Font and verse-size settings change mesra widths without resizing the column.
    const settingsObserver = new MutationObserver(measure);
    settingsObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-font", "data-poem-font-size", "style"],
    });
    document.fonts?.ready.then(measure).catch(() => undefined);
    return () => {
      resizeObserver.disconnect();
      settingsObserver.disconnect();
    };
  }, [poemTextRef, poemId]);

  return isStacked;
}
