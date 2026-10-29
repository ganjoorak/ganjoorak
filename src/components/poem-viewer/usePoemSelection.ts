"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export interface PoemSelection {
  /** Rendered line indices (the same indexing as poemToLines), inclusive, whole lines. */
  from: number;
  to: number;
  /** Viewport rectangle around the selected lines. */
  rect: { top: number; bottom: number; left: number; right: number };
}

const SETTLE_MS = 140;
// A scroll right after the menu appears is the browser settling the selection, not the reader leaving it.
const SCROLL_GRACE_MS = 350;

const sameRange = (a: PoemSelection | null, b: PoemSelection | null) =>
  a === b || (a !== null && b !== null && a.from === b.from && a.to === b.to);

/**
 * Maps the reader's text selection inside the open poem to whole rendered lines: every
 * `[data-line-index]` element (see PoemBody) that the selection actually covers, so touching a line's edge
 * does not pull it in. The selection is rounded outwards to those lines. Follows `selectionchange`, which
 * is also how touch devices report dragging the native handles; changes are debounced until it settles.
 *
 * `visible` goes false on scroll, Escape or when the selection collapses; the browser's own selection is
 * left alone except on Escape.
 */
export function usePoemSelection({
  containerRef,
  poemId,
  enabled,
}: {
  containerRef: RefObject<HTMLElement | null>;
  poemId: string;
  enabled: boolean;
}) {
  const [selection, setSelection] = useState<PoemSelection | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);
  const shownAtRef = useRef(0);
  const holdUntilRef = useRef(0);
  const computeRef = useRef<() => void>(() => undefined);
  const selectionRef = useRef<PoemSelection | null>(null);

  const compute = useCallback(() => {
    const clear = () => {
      if (!selectionRef.current) return;
      selectionRef.current = null;
      setSelection(null);
    };
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      // The reader is pressing a button of the menu, which can collapse the selection on some browsers.
      if (Date.now() < holdUntilRef.current) return;
      clear();
      return;
    }
    const root = containerRef.current?.querySelector<HTMLElement>(
      `.poem-text[data-poem-id="${CSS.escape(poemId)}"]`,
    );
    if (!root) {
      clear();
      return;
    }
    const range = sel.getRangeAt(0);
    if (!range.intersectsNode(root)) {
      clear();
      return;
    }
    let from = Infinity;
    let to = -1;
    const covered = new Map<number, HTMLElement>();
    root.querySelectorAll<HTMLElement>("[data-line-index]").forEach((element) => {
      const index = Number(element.dataset.lineIndex);
      if (!Number.isInteger(index)) return;
      const lineRange = document.createRange();
      lineRange.selectNodeContents(element);
      // The selection starts before this line ends and ends after it starts.
      const overlaps =
        range.compareBoundaryPoints(Range.END_TO_START, lineRange) < 0 &&
        range.compareBoundaryPoints(Range.START_TO_END, lineRange) > 0;
      if (!overlaps) return;
      covered.set(index, element);
      from = Math.min(from, index);
      to = Math.max(to, index);
    });
    if (to < from) {
      clear();
      return;
    }
    let top = Infinity;
    let bottom = -Infinity;
    let left = Infinity;
    let right = -Infinity;
    covered.forEach((element) => {
      const box = (element.querySelector(".verse-text") ?? element).getBoundingClientRect();
      if (box.width === 0 && box.height === 0) return;
      top = Math.min(top, box.top);
      bottom = Math.max(bottom, box.bottom);
      left = Math.min(left, box.left);
      right = Math.max(right, box.right);
    });
    if (!Number.isFinite(top)) {
      clear();
      return;
    }
    const next: PoemSelection = { from, to, rect: { top, bottom, left, right } };
    if (!sameRange(selectionRef.current, next)) {
      shownAtRef.current = Date.now();
      setIsDismissed(false);
    }
    selectionRef.current = next;
    setSelection(next);
  }, [containerRef, poemId]);
  computeRef.current = compute;

  // A different poem, or the toolbar being turned off, drops whatever was selected.
  useEffect(() => {
    selectionRef.current = null;
    setSelection(null);
  }, [poemId, enabled]);

  useEffect(() => {
    if (!enabled) return;
    let timer: number | null = null;
    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        computeRef.current();
      }, SETTLE_MS);
    };
    document.addEventListener("selectionchange", schedule);
    return () => {
      document.removeEventListener("selectionchange", schedule);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [enabled]);

  const hasSelection = selection !== null;
  useEffect(() => {
    if (!hasSelection || !enabled) return;
    const onScroll = () => {
      if (Date.now() - shownAtRef.current > SCROLL_GRACE_MS) setIsDismissed(true);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsDismissed(true);
      window.getSelection()?.removeAllRanges();
    };
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("wheel", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("wheel", onScroll);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [hasSelection, enabled]);

  /** Called while a toolbar button is pressed: the selection may collapse before the click lands. */
  const holdOpen = useCallback(() => {
    holdUntilRef.current = Date.now() + 700;
    window.setTimeout(() => computeRef.current(), 760);
  }, []);

  const dismiss = useCallback(() => {
    setIsDismissed(true);
    selectionRef.current = null;
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  return { selection, isVisible: selection !== null && !isDismissed && enabled, holdOpen, dismiss };
}
