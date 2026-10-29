"use client";

import { useCallback, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";

/**
 * The chip above the title (e.g. the feed switch) is pinned: drawn once in a layer above the poem (and above
 * the pull-to-next sheet), at the spot of an empty spacer in the title, and it stays there while the poem
 * scrolls, changes or is pulled. Layout offsets ignore transforms, so animating frames never move it.
 */
export function usePinnedEyebrow(
  viewerRef: RefObject<HTMLDivElement | null>,
  chip: ReactNode,
  isTitleShown: boolean,
) {
  const poemContentRef = useRef<HTMLDivElement>(null);
  const eyebrowLayerRef = useRef<HTMLDivElement>(null);
  const eyebrowSpacerRef = useRef<HTMLDivElement | null>(null);

  const placeEyebrow = useCallback(() => {
    const layer = eyebrowLayerRef.current;
    const content = poemContentRef.current;
    const spacer = eyebrowSpacerRef.current;
    const viewer = viewerRef.current;
    const chipElement = layer?.firstElementChild as HTMLElement | null | undefined;
    if (!layer || !content || !spacer || !viewer || !chipElement) return;
    // Spacers (live poem and pull sheet) read these, so the title always starts below the chip.
    viewer.style.setProperty("--poem-eyebrow-height", `${chipElement.offsetHeight}px`);
    viewer.style.setProperty("--poem-eyebrow-gap", getComputedStyle(chipElement).marginBottom);
    let top = 0;
    let node: HTMLElement | null = spacer;
    while (node && node !== content) {
      top += node.offsetTop;
      node = node.offsetParent as HTMLElement | null;
    }
    if (node !== content) return;
    // The unscrolled spot: the chip stays pinned while the poem scrolls under it.
    layer.style.transform = `translate3d(0, ${top}px, 0)`;
  }, [viewerRef]);

  // A new poem's spacer mounts while the old poem is still sliding out (AnimatePresence mode="popLayout").
  const attachEyebrowSpacer = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return;
      eyebrowSpacerRef.current = element;
      placeEyebrow();
      // Again once the new poem has laid out (its fonts and frame are in place by the next frame).
      const frame = requestAnimationFrame(placeEyebrow);
      // React 19 ref cleanup: an old spacer leaving later must not clear the new one.
      return () => {
        cancelAnimationFrame(frame);
        if (eyebrowSpacerRef.current === element) eyebrowSpacerRef.current = null;
      };
    },
    [placeEyebrow],
  );

  useLayoutEffect(() => {
    const content = poemContentRef.current;
    const chipElement = eyebrowLayerRef.current?.firstElementChild;
    if (!content || !chipElement) return;
    placeEyebrow();
    const observer = new ResizeObserver(placeEyebrow);
    observer.observe(content);
    observer.observe(chipElement);
    return () => observer.disconnect();
  }, [placeEyebrow, chip, isTitleShown]);

  return { poemContentRef, eyebrowLayerRef, attachEyebrowSpacer };
}
