"use client";

import type React from "react";
import { useEffect, useRef } from "react";
import { consumeWheelGesture, trackWheelGesture, WHEEL_GESTURE_EDGE_PX } from "@/utils/wheelGesture";

/** Finger travel (share of the viewport height) needed to commit to the next poem on release. */
const COMMIT_RATIO = 0.33;
/** A quick flick commits earlier: past this share of the viewport and faster than FLICK_SPEED px/ms. */
const FLICK_RATIO = 0.16;
const FLICK_SPEED = 0.55;
const WHEEL_IDLE_MS = 220;
const COMMIT_MS = 280;
const SPRING_MS = 320;
const NAVIGATION_TIMEOUT_MS = 6000;
const PULLING_CLASS = "gk-pulling-next";

interface Options {
  /** The scroll container (.poem-text). */
  scrollRef: React.RefObject<HTMLElement | null>;
  /** Element the gesture listeners attach to (the viewer root). */
  rootRef: React.RefObject<HTMLElement | null>;
  /** The sheet that slides up (rendered fixed, just below the viewport). */
  sheetRef: React.RefObject<HTMLElement | null>;
  enabled: boolean;
  /** Whether the next poem is known. Without it the sheet can still be pulled, but always springs back. */
  hasNext: boolean;
  onCommit: () => void;
  /** Changes when the next poem has arrived; the sheet then fades away. */
  resetKey: unknown;
}

const isTrulyAtBottom = (el: HTMLElement) =>
  el.scrollHeight - el.scrollTop - el.clientHeight <= WHEEL_GESTURE_EDGE_PX;

/** Rubber band: follows the finger almost 1:1 at first, then gets heavier. */
const resist = (distance: number, viewport: number) => {
  const limit = viewport * 0.92;
  return limit * (1 - 1 / (distance / limit * 1.15 + 1));
};

/**
 * Pull-to-next: at the bottom of a poem, dragging further up (touch) or wheeling further down slides the
 * next poem up from the bottom. Past the threshold it commits (animates fully up, then onCommit);
 * otherwise it springs back. Transform-only, honours prefers-reduced-motion.
 */
export function usePullToNext({ scrollRef, rootRef, sheetRef, enabled, hasNext, onCommit, resetKey }: Options) {
  const enabledRef = useRef(enabled);
  const hasNextRef = useRef(hasNext);
  hasNextRef.current = hasNext;
  const onCommitRef = useRef(onCommit);
  const committingRef = useRef(false);
  const timeoutRef = useRef<number | null>(null);
  enabledRef.current = enabled;
  onCommitRef.current = onCommit;

  // The next poem arrived (or the viewer changed): fade the covering sheet away and reset.
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!committingRef.current || !sheet) return;
    committingRef.current = false;
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    sheet.style.transition = reduced ? "none" : "opacity 200ms ease";
    sheet.style.opacity = "0";
    timeoutRef.current = window.setTimeout(() => {
      sheet.style.transition = "none";
      sheet.style.transform = "translate3d(0, 0, 0)";
      sheet.style.opacity = "";
      sheet.removeAttribute("data-state");
      sheet.removeAttribute("data-armed");
      const scrim = sheet.previousElementSibling as HTMLElement | null;
      if (scrim) scrim.style.opacity = "0";
      document.documentElement.classList.remove(PULLING_CLASS);
      timeoutRef.current = null;
    }, reduced ? 0 : 220);
  }, [resetKey, sheetRef]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const html = document.documentElement;
    const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const viewport = () => window.innerHeight || 800;

    // Writes are batched to one per frame and touch only the sheet, the scrim and (on start/end) one class.
    let frame = 0;
    let pending: { px: number; transition: string } | null = null;
    const flush = () => {
      frame = 0;
      const sheet = sheetRef.current;
      const next = pending;
      pending = null;
      if (!sheet || !next) return;
      const { px, transition } = next;
      const progress = Math.max(0, Math.min(1, px / viewport()));
      sheet.style.transition = transition;
      sheet.style.transform = `translate3d(0, ${-px}px, 0)`;
      const state = px > 0 ? "pulling" : "";
      if ((sheet.dataset.state || "") !== state) sheet.dataset.state = state;
      const scrim = sheet.previousElementSibling as HTMLElement | null;
      if (scrim) {
        scrim.style.transition = transition.replace("transform", "opacity");
        scrim.style.opacity = (progress * 0.45).toFixed(3);
      }
      if (html.classList.contains(PULLING_CLASS) !== px > 0) html.classList.toggle(PULLING_CLASS, px > 0);
    };
    const setPull = (px: number, transition: string, immediate = false) => {
      pending = { px, transition };
      if (immediate) {
        if (frame) cancelAnimationFrame(frame);
        flush();
        return;
      }
      if (!frame) frame = requestAnimationFrame(flush);
    };

    const setArmed = (armed: boolean) => {
      const sheet = sheetRef.current;
      if (sheet) sheet.toggleAttribute("data-armed", armed);
    };

    const springBack = () => {
      const sheet = sheetRef.current;
      setArmed(false);
      if (!sheet) return;
      if (reducedMotion()) {
        setPull(0, "none", true);
        return;
      }
      setPull(0, `transform ${SPRING_MS}ms cubic-bezier(0.2, 0.9, 0.3, 1.15)`, true);
    };

    const commit = () => {
      if (committingRef.current) return;
      if (!hasNextRef.current) {
        // The next poem is not loaded yet: never navigate somewhere the sheet did not show.
        springBack();
        return;
      }
      committingRef.current = true;
      const vh = viewport();
      const duration = reducedMotion() ? 0 : COMMIT_MS;
      setPull(vh, duration ? `transform ${duration}ms cubic-bezier(0.2, 0.8, 0.2, 1)` : "none", true);
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => {
        onCommitRef.current();
        // If the navigation is refused (cooldown, lock, error), do not leave the sheet covering the screen.
        timeoutRef.current = window.setTimeout(() => {
          if (!committingRef.current) return;
          committingRef.current = false;
          springBack();
        }, NAVIGATION_TIMEOUT_MS);
      }, duration);
    };

    // ---- touch ----
    let tracking = false;
    let decided = false;
    let pulling = false;
    let startX = 0;
    let startY = 0;
    let baseY: number | null = null;
    let distance = 0;
    let samples: Array<{ y: number; t: number }> = [];

    const onTouchStart = (event: TouchEvent) => {
      tracking = false;
      pulling = false;
      if (!enabledRef.current || committingRef.current || event.touches.length !== 1) return;
      const el = scrollRef.current;
      if (!el || !(event.target instanceof Node) || !el.contains(event.target)) return;
      const t = event.touches[0];
      tracking = true;
      decided = false;
      startX = t.clientX;
      startY = t.clientY;
      baseY = isTrulyAtBottom(el) ? t.clientY : null;
      distance = 0;
      samples = [{ y: t.clientY, t: event.timeStamp }];
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!tracking) return;
      const el = scrollRef.current;
      const t = event.touches[0];
      if (!el || !t) return;
      if (!decided) {
        const dx = Math.abs(t.clientX - startX);
        const dy = Math.abs(t.clientY - startY);
        if (dx < 6 && dy < 6) return;
        decided = true;
        if (dx > dy) {
          tracking = false;
          return;
        }
      }
      samples.push({ y: t.clientY, t: event.timeStamp });
      if (samples.length > 5) samples.shift();
      // Like the wheel, a pull must start with the poem already at its bottom: a swipe that merely scrolls
      // to the end does not turn into a pull halfway through.
      if (baseY === null) return;
      const d = baseY - t.clientY;
      if (d <= 0) {
        if (pulling) {
          pulling = false;
          distance = 0;
          setArmed(false);
          setPull(0, "none");
        }
        // The finger scrolled the poem back up: this touch is a normal scroll now.
        if (!isTrulyAtBottom(el)) baseY = null;
        return;
      }
      if (event.cancelable) event.preventDefault();
      pulling = true;
      distance = d;
      setArmed(d >= viewport() * COMMIT_RATIO);
      setPull(resist(d, viewport()), "none");
    };

    const onTouchEnd = () => {
      if (!tracking) return;
      tracking = false;
      if (!pulling) return;
      pulling = false;
      const vh = viewport();
      let speed = 0;
      if (samples.length > 1) {
        const first = samples[0];
        const last = samples[samples.length - 1];
        const dt = last.t - first.t;
        if (dt > 0) speed = (first.y - last.y) / dt;
      }
      if (distance >= vh * COMMIT_RATIO || (distance >= vh * FLICK_RATIO && speed >= FLICK_SPEED)) {
        commit();
      } else {
        springBack();
      }
    };

    // ---- wheel / touchpad ----
    // Passive listener: normal scrolling stays fully native. A pull only starts on a *fresh* wheel gesture
    // that began with the poem already at its very bottom; the inertia tail of the scroll that reached the
    // bottom, and the tail after a commit, are ignored (see wheelGesture.ts).
    let wheelTotal = 0;
    let wheelTimer: number | null = null;

    const onWheel = (event: WheelEvent) => {
      const el = scrollRef.current;
      const gesture = trackWheelGesture(event, el);
      if (!enabledRef.current || committingRef.current || !el) return;
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * viewport() : event.deltaY;
      if (wheelTotal <= 0) {
        if (delta <= 0 || gesture.consumed || !gesture.startedAtBottom || !isTrulyAtBottom(el)) return;
      }
      wheelTotal = Math.max(0, wheelTotal + delta);
      const vh = viewport();
      if (wheelTotal >= vh * COMMIT_RATIO && hasNextRef.current) {
        wheelTotal = 0;
        if (wheelTimer !== null) window.clearTimeout(wheelTimer);
        wheelTimer = null;
        consumeWheelGesture(gesture.id);
        setArmed(true);
        commit();
        return;
      }
      setPull(resist(wheelTotal, vh), "none");
      if (wheelTimer !== null) window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => {
        wheelTimer = null;
        wheelTotal = 0;
        if (!committingRef.current) springBack();
      }, WHEEL_IDLE_MS);
    };

    root.addEventListener("touchstart", onTouchStart, { passive: true });
    root.addEventListener("touchmove", onTouchMove, { passive: false });
    root.addEventListener("touchend", onTouchEnd, { passive: true });
    root.addEventListener("touchcancel", onTouchEnd, { passive: true });
    root.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      root.removeEventListener("touchstart", onTouchStart);
      root.removeEventListener("touchmove", onTouchMove);
      root.removeEventListener("touchend", onTouchEnd);
      root.removeEventListener("touchcancel", onTouchEnd);
      root.removeEventListener("wheel", onWheel);
      if (wheelTimer !== null) window.clearTimeout(wheelTimer);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [rootRef, scrollRef, sheetRef]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      document.documentElement.classList.remove(PULLING_CLASS);
    };
  }, []);
}
