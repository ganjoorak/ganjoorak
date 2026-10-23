"use client";

import type React from "react";
import { useEffect, useRef } from "react";

/** Finger travel (share of the viewport height) needed to commit to the next poem on release. */
const COMMIT_RATIO = 0.33;
/** A quick flick commits earlier: past this share of the viewport and faster than FLICK_SPEED px/ms. */
const FLICK_RATIO = 0.16;
const FLICK_SPEED = 0.55;
const EDGE_PX = 8;
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
  onCommit: () => void;
  /** Changes when the next poem has arrived; the sheet then fades away. */
  resetKey: unknown;
}

const isAtBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight <= EDGE_PX;

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
export function usePullToNext({ scrollRef, rootRef, sheetRef, enabled, onCommit, resetKey }: Options) {
  const enabledRef = useRef(enabled);
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
      document.documentElement.classList.remove(PULLING_CLASS);
      document.documentElement.style.removeProperty("--gk-pull-progress");
      timeoutRef.current = null;
    }, reduced ? 0 : 220);
  }, [resetKey, sheetRef]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const html = document.documentElement;
    const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const viewport = () => window.innerHeight || 800;

    const setPull = (px: number, transition: string) => {
      const sheet = sheetRef.current;
      if (!sheet) return;
      const vh = viewport();
      const progress = Math.max(0, Math.min(1, px / vh));
      sheet.style.transition = transition;
      sheet.style.transform = `translate3d(0, ${-px}px, 0)`;
      sheet.dataset.state = px > 0 ? "pulling" : "";
      html.style.setProperty("--gk-pull-progress", progress.toFixed(3));
      html.classList.toggle(PULLING_CLASS, px > 0);
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
        setPull(0, "none");
        return;
      }
      setPull(0, `transform ${SPRING_MS}ms cubic-bezier(0.2, 0.9, 0.3, 1.15)`);
    };

    const commit = () => {
      if (committingRef.current) return;
      committingRef.current = true;
      const vh = viewport();
      const duration = reducedMotion() ? 0 : COMMIT_MS;
      setPull(vh, duration ? `transform ${duration}ms cubic-bezier(0.2, 0.8, 0.2, 1)` : "none");
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
      baseY = isAtBottom(el) ? t.clientY : null;
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
      if (baseY === null) {
        if (!isAtBottom(el)) return;
        baseY = t.clientY;
      }
      const d = baseY - t.clientY;
      if (d <= 0) {
        if (pulling) {
          pulling = false;
          distance = 0;
          setArmed(false);
          setPull(0, "none");
        }
        if (!isAtBottom(el)) baseY = null;
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

    // ---- wheel (desktop, or a mouse on a phone) ----
    let wheelTotal = 0;
    let wheelTimer: number | null = null;

    const onWheel = (event: WheelEvent) => {
      if (!enabledRef.current || committingRef.current) return;
      const el = scrollRef.current;
      if (!el) return;
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * viewport() : event.deltaY;
      if (wheelTotal <= 0 && (delta <= 0 || !isAtBottom(el))) return;
      if (event.cancelable) event.preventDefault();
      wheelTotal = Math.max(0, wheelTotal + delta);
      const vh = viewport();
      if (wheelTotal >= vh * COMMIT_RATIO) {
        wheelTotal = 0;
        if (wheelTimer !== null) window.clearTimeout(wheelTimer);
        wheelTimer = null;
        commit();
        return;
      }
      setArmed(false);
      setPull(resist(wheelTotal, vh), reducedMotion() ? "none" : "transform 90ms linear");
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
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      root.removeEventListener("touchstart", onTouchStart);
      root.removeEventListener("touchmove", onTouchMove);
      root.removeEventListener("touchend", onTouchEnd);
      root.removeEventListener("touchcancel", onTouchEnd);
      root.removeEventListener("wheel", onWheel);
      if (wheelTimer !== null) window.clearTimeout(wheelTimer);
    };
  }, [rootRef, scrollRef, sheetRef]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      document.documentElement.classList.remove(PULLING_CLASS);
      document.documentElement.style.removeProperty("--gk-pull-progress");
    };
  }, []);
}
