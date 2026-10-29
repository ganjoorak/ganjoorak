"use client";

import type React from "react";
import { useCallback, useEffect, useRef } from "react";
import {
  consumeWheelGesture,
  MOUSE_IDLE_MS,
  MOUSE_NOTCHES_TO_NAVIGATE,
  trackWheelGesture,
  WHEEL_GESTURE_EDGE_PX,
} from "@/utils/wheelGesture";

/** Finger travel (share of the viewport height) needed to commit to the next poem on release. */
const COMMIT_RATIO = 0.33;
/** A quick flick commits earlier: past this share of the viewport and faster than FLICK_SPEED px/ms. */
const FLICK_RATIO = 0.16;
const FLICK_SPEED = 0.55;
const WHEEL_IDLE_MS = 220;
/**
 * Mouse notches move a target; the sheet follows it every frame with a frame-rate independent lerp (time
 * constant LERP_TAU_MS), so each notch reads as one smooth push instead of a rigid block step.
 */
const LERP_TAU_MS = 80;
/** A mouse commit finishes the slide on a sheet-like curve, starting at least as fast as the lerp was moving. */
const MOUSE_COMMIT_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const MOUSE_COMMIT_EASE_SLOPE = 0.72 / 0.32;
const MOUSE_COMMIT_MIN_MS = 300;
const MOUSE_COMMIT_MAX_MS = 420;
/** Commit glide when the release has no usable speed; faster releases finish sooner (see commitDuration). */
const COMMIT_MS = 250;
const COMMIT_MIN_MS = 150;
const COMMIT_MAX_MS = 320;
/** Ease-out whose initial slope (0.61 / 0.22) is used to match the release speed. */
const COMMIT_EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";
const COMMIT_EASE_SLOPE = 0.61 / 0.22;
const SPRING_MS = 320;
/** Frames to wait for the landed poem to render before giving up and removing the sheet anyway. */
const LAND_MAX_FRAMES = 90;
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
  /**
   * Changes when the next poem has arrived. Once the scroll container carries `data-poem-id` equal to it (the
   * landed poem is rendered under the sheet), the sheet is removed instantly: it was an exact copy.
   */
  resetKey: unknown;
}

const isTrulyAtBottom = (el: HTMLElement) =>
  el.scrollHeight - el.scrollTop - el.clientHeight <= WHEEL_GESTURE_EDGE_PX;

/** Light rubber band: 1:1 with the finger for most of the screen, slightly heavier only near the top. */
const resist = (distance: number, viewport: number) => {
  const knee = viewport * 0.6;
  if (distance <= knee) return distance;
  return Math.min(viewport, knee + (distance - knee) * 0.55);
};

/** Glide time so the sheet leaves the finger at the speed it was moving (px/ms), then eases out. */
const commitDuration = (remaining: number, speed: number) => {
  if (!(speed > 0.05)) return COMMIT_MS;
  return Math.round(Math.max(COMMIT_MIN_MS, Math.min(COMMIT_MAX_MS, (COMMIT_EASE_SLOPE * remaining) / speed)));
};

const transitionFor = (timing: string | null) =>
  timing ? `transform ${timing}, border-radius ${timing}, box-shadow ${timing}` : "none";

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
  // Set by the gesture effect: runs the same full slide a released pull does (used by the ⌄ button).
  const commitRef = useRef<(() => boolean) | null>(null);
  enabledRef.current = enabled;
  onCommitRef.current = onCommit;

  // The next poem arrived: as soon as it is rendered under the sheet, drop the sheet in one frame. No fade:
  // the sheet is pixel-identical to the landed poem, so removing it is invisible.
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!committingRef.current || !sheet) return;
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    let frames = 0;
    let raf = 0;
    const finish = () => {
      committingRef.current = false;
      sheet.style.transition = "none";
      sheet.style.transform = "translate3d(0, 0, 0)";
      sheet.style.setProperty("--gk-pull-p", "0");
      sheet.removeAttribute("data-state");
      sheet.removeAttribute("data-armed");
      const scrim = sheet.previousElementSibling as HTMLElement | null;
      if (scrim) {
        scrim.style.transition = "none";
        scrim.style.opacity = "0";
      }
      // The landed poem is a new .poem-text (keyed by id), but clear any push left on the live one regardless.
      const content = scrollRef.current;
      if (content) {
        content.style.transition = "";
        content.style.transform = "";
      }
      document.documentElement.classList.remove(PULLING_CLASS);
    };
    const waitForLanding = () => {
      frames += 1;
      const landed = scrollRef.current?.dataset.poemId === String(resetKey);
      if (landed || frames >= LAND_MAX_FRAMES) {
        // One more frame so the landed poem has been painted underneath before the cover goes.
        raf = requestAnimationFrame(finish);
        return;
      }
      raf = requestAnimationFrame(waitForLanding);
    };
    raf = requestAnimationFrame(waitForLanding);
    return () => cancelAnimationFrame(raf);
  }, [resetKey, scrollRef, sheetRef]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const html = document.documentElement;
    const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const viewport = () => window.innerHeight || 800;

    // Writes are batched to one per frame and touch only the sheet, the live poem, the scrim and (on start/end)
    // one class. The live poem moves up with the sheet, so the two read as one continuous strip being pushed.
    let frame = 0;
    let clearContentTimer: number | null = null;
    let pending: { px: number; timing: string | null } | null = null;
    let currentPx = 0;
    const flush = () => {
      frame = 0;
      const sheet = sheetRef.current;
      const next = pending;
      pending = null;
      if (!sheet || !next) return;
      const { px, timing } = next;
      const progress = Math.max(0, Math.min(1, px / viewport()));
      sheet.style.transition = transitionFor(timing);
      sheet.style.setProperty("--gk-pull-t", timing ?? "0s");
      sheet.style.setProperty("--gk-pull-p", progress.toFixed(4));
      sheet.style.transform = `translate3d(0, ${-px}px, 0)`;
      const content = scrollRef.current;
      if (content) {
        if (clearContentTimer !== null) window.clearTimeout(clearContentTimer);
        clearContentTimer = null;
        content.style.transition = timing ? `transform ${timing}` : "none";
        content.style.transform = `translate3d(0, ${-px}px, 0)`;
        if (px <= 0) {
          // Do not leave a transform (and a containing block) on the scroller once it is back in place.
          const clear = () => {
            clearContentTimer = null;
            if (currentPx > 0) return;
            content.style.transition = "";
            content.style.transform = "";
          };
          if (timing) clearContentTimer = window.setTimeout(clear, SPRING_MS + 80);
          else clear();
        }
      }
      const state = px > 0 ? "pulling" : "";
      if ((sheet.dataset.state || "") !== state) sheet.dataset.state = state;
      const scrim = sheet.previousElementSibling as HTMLElement | null;
      if (scrim) {
        scrim.style.transition = timing ? `opacity ${timing}` : "none";
        scrim.style.opacity = (progress * 0.3).toFixed(3);
      }
      if (html.classList.contains(PULLING_CLASS) !== px > 0) html.classList.toggle(PULLING_CLASS, px > 0);
    };
    const setPull = (px: number, timing: string | null, immediate = false) => {
      currentPx = px;
      pending = { px, timing };
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

    // ---- mouse lerp ----
    let lerpTarget = 0;
    let lerpRaf = 0;
    let lerpLast = 0;
    let lerpVel = 0;
    const stopLerp = () => {
      if (lerpRaf) cancelAnimationFrame(lerpRaf);
      lerpRaf = 0;
    };
    const lerpStep = (now: number) => {
      const dt = Math.min(48, Math.max(1, now - lerpLast));
      lerpLast = now;
      const prev = currentPx;
      let px = prev + (lerpTarget - prev) * (1 - Math.exp(-dt / LERP_TAU_MS));
      if (Math.abs(lerpTarget - px) < 0.5) px = lerpTarget;
      lerpVel = (px - prev) / dt;
      setPull(px, null, true);
      lerpRaf = px === lerpTarget ? 0 : requestAnimationFrame(lerpStep);
      if (!lerpRaf) lerpVel = 0;
    };
    const lerpTo = (target: number) => {
      lerpTarget = target;
      if (lerpRaf) return;
      // After a landing the sheet was reset outside this closure: a new pull starts from rest.
      if (!html.classList.contains(PULLING_CLASS)) currentPx = 0;
      lerpLast = performance.now();
      lerpRaf = requestAnimationFrame(lerpStep);
    };

    const springBack = () => {
      stopLerp();
      const sheet = sheetRef.current;
      setArmed(false);
      if (!sheet) return;
      if (reducedMotion()) {
        setPull(0, null, true);
        return;
      }
      setPull(0, `${SPRING_MS}ms cubic-bezier(0.2, 0.9, 0.3, 1.15)`, true);
    };

    /** Glide from wherever the sheet is to the top, continuing at the release speed (px/ms), then navigate. */
    const commit = (speed = 0, mouse = false) => {
      stopLerp();
      if (committingRef.current) return;
      if (!hasNextRef.current) {
        // The next poem is not loaded yet: never navigate somewhere the sheet did not show.
        springBack();
        return;
      }
      committingRef.current = true;
      const vh = viewport();
      const remaining = Math.max(0, vh - currentPx);
      let duration = reducedMotion() ? 0 : commitDuration(remaining, speed);
      let ease = COMMIT_EASE;
      if (mouse && duration) {
        // Finish the slide from where the lerp is, at no less than its current speed.
        const v = Math.max(speed, 0.8);
        duration = Math.round(Math.max(MOUSE_COMMIT_MIN_MS, Math.min(MOUSE_COMMIT_MAX_MS, (MOUSE_COMMIT_EASE_SLOPE * remaining) / v)));
        ease = MOUSE_COMMIT_EASE;
      }
      setPull(vh, duration ? `${duration}ms ${ease}` : null, true);
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
      // Adjusting a text selection (see PoemSelectionMenu), not pulling.
      if (event.target instanceof Element && event.target.closest("[data-quote-selected]")) return;
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
          setPull(0, null);
        }
        // The finger scrolled the poem back up: this touch is a normal scroll now.
        if (!isTrulyAtBottom(el)) baseY = null;
        return;
      }
      if (event.cancelable) event.preventDefault();
      pulling = true;
      distance = d;
      setArmed(d >= viewport() * COMMIT_RATIO);
      setPull(resist(d, viewport()), null);
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
        commit(Math.max(0, speed));
      } else {
        springBack();
      }
    };

    // ---- wheel / touchpad ----
    // Normal scrolling stays fully native (preventDefault only swallows a navigated gesture's tail). A pull only starts on a *fresh* wheel gesture
    // that began with the poem already at its very bottom; the inertia tail of the scroll that reached the
    // bottom, and the tail after a commit, are ignored (see wheelGesture.ts).
    let wheelTotal = 0;
    let wheelTimer: number | null = null;
    let wheelSamples: Array<{ total: number; t: number }> = [];
    const wheelSpeed = () => {
      if (wheelSamples.length < 2) return 0;
      const first = wheelSamples[0];
      const last = wheelSamples[wheelSamples.length - 1];
      const dt = last.t - first.t;
      return dt > 0 ? (last.total - first.total) / dt : 0;
    };

    const onWheel = (event: WheelEvent) => {
      const el = scrollRef.current;
      const gesture = trackWheelGesture(event, el);
      // The inertia tail of a gesture that already navigated must not scroll the poem that just landed:
      // that drift read as "the page comes up again". A new gesture (after a short pause) scrolls normally.
      if (gesture.consumed) {
        if (event.cancelable) event.preventDefault();
        return;
      }
      if (!enabledRef.current || committingRef.current || !el) return;
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * viewport() : event.deltaY;
      if (wheelTotal <= 0) {
        if (delta <= 0 || gesture.consumed || !gesture.startedAtBottom || !isTrulyAtBottom(el)) return;
      }
      const vh = viewport();
      const commitPx = vh * COMMIT_RATIO;
      if (gesture.mouse) {
        // While the sheet is out, a notch belongs to it: a notch back up must not scroll the poem underneath.
        if (wheelTotal > 0 && event.cancelable) event.preventDefault();
        // Mouse: count notches. Each one moves the sheet a third of the way to the commit point (animated),
        // a notch back up undoes one, and the third commits.
        wheelTotal = Math.max(0, wheelTotal + Math.sign(delta) * (commitPx / MOUSE_NOTCHES_TO_NAVIGATE));
        wheelSamples = [];
      } else {
        if (wheelTotal <= 0) wheelSamples = [];
        wheelTotal = Math.max(0, wheelTotal + delta);
        wheelSamples.push({ total: wheelTotal, t: event.timeStamp });
        if (wheelSamples.length > 6) wheelSamples.shift();
      }
      if (wheelTotal >= commitPx - 0.5 && hasNextRef.current) {
        wheelTotal = 0;
        if (wheelTimer !== null) window.clearTimeout(wheelTimer);
        wheelTimer = null;
        consumeWheelGesture(gesture.id);
        setArmed(true);
        commit(gesture.mouse ? Math.max(0, lerpVel) : Math.max(0, wheelSpeed()), gesture.mouse);
        return;
      }
      if (wheelTotal <= 0) {
        if (wheelTimer !== null) window.clearTimeout(wheelTimer);
        wheelTimer = null;
        springBack();
        return;
      }
      if (gesture.mouse && !reducedMotion()) lerpTo(resist(wheelTotal, vh));
      else {
        stopLerp();
        setPull(resist(wheelTotal, vh), null);
      }
      if (wheelTimer !== null) window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => {
        wheelTimer = null;
        wheelTotal = 0;
        if (!committingRef.current) springBack();
      }, gesture.mouse ? MOUSE_IDLE_MS : WHEEL_IDLE_MS);
    };

    root.addEventListener("touchstart", onTouchStart, { passive: true });
    root.addEventListener("touchmove", onTouchMove, { passive: false });
    root.addEventListener("touchend", onTouchEnd, { passive: true });
    root.addEventListener("touchcancel", onTouchEnd, { passive: true });
    root.addEventListener("wheel", onWheel, { passive: false });
    commitRef.current = () => {
      if (!enabledRef.current || committingRef.current || !hasNextRef.current) return false;
      // As a mouse pull released from rest: the whole strip glides up at the mouse commit pace.
      commit(0.8, true);
      return true;
    };
    return () => {
      commitRef.current = null;
      root.removeEventListener("touchstart", onTouchStart);
      root.removeEventListener("touchmove", onTouchMove);
      root.removeEventListener("touchend", onTouchEnd);
      root.removeEventListener("touchcancel", onTouchEnd);
      root.removeEventListener("wheel", onWheel);
      if (wheelTimer !== null) window.clearTimeout(wheelTimer);
      if (clearContentTimer !== null) window.clearTimeout(clearContentTimer);
      if (frame) cancelAnimationFrame(frame);
      stopLerp();
    };
  }, [rootRef, scrollRef, sheetRef]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      document.documentElement.classList.remove(PULLING_CLASS);
    };
  }, []);

  /** Slide the next poem up exactly like a pull does; false when it can't (disabled, busy, not loaded). */
  const commitNext = useCallback(() => commitRef.current?.() ?? false, []);
  return { commitNext };
}
