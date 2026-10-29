"use client";

import { useEffect, useRef, type RefObject } from "react";
import { consumeWheelGesture, MOUSE_NOTCHES_TO_NAVIGATE, trackWheelGesture } from "@/utils/wheelGesture";

const NAVIGATION_COOLDOWN_MS = 950;
const BOUNDARY_READ_DELAY_MS = 450;
const SWIPE_TRIGGER_DISTANCE = 80;
const EDGE_THRESHOLD_PX = 32;

interface EdgeNavigationOptions {
  scrollRef: RefObject<HTMLDivElement | null>;
  rootRef: RefObject<HTMLDivElement | null>;
  poemId: number | string;
  isFirst: boolean;
  /** e.g. while a dialog owns the wheel. */
  disabled: boolean;
  onPrevious: () => void;
}

/**
 * Wheel or swipe down at the top of a poem goes back to the previous one, once the reader has rested at the
 * top for a moment. "Next" at the bottom is handled progressively by usePullToNext.
 */
export function useEdgeNavigation({
  scrollRef,
  rootRef,
  poemId,
  isFirst,
  disabled,
  onPrevious,
}: EdgeNavigationOptions) {
  const boundaryNavigationUntilRef = useRef(0);
  const lastBoundaryNavigationAtRef = useRef(0);
  const reachedTopAtRef = useRef(0);

  // A new poem starts at its top; navigating straight on is held back briefly.
  useEffect(() => {
    const now = Date.now();
    lastBoundaryNavigationAtRef.current = now;
    boundaryNavigationUntilRef.current = now + 750;
    reachedTopAtRef.current = now;
  }, [poemId]);

  useEffect(() => {
    const poemText = scrollRef.current;
    const root = rootRef.current;
    if (!poemText || !root) return;

    const isScrollNearTop = () => {
      if (!scrollRef.current) return false;
      return scrollRef.current.scrollTop <= 1;
    };

    let touchStartY = 0;
    let touchStartedAtTop = false;

    const canNavigate = () => {
      const now = Date.now();
      if (now < boundaryNavigationUntilRef.current) {
        return false;
      }
      if (now - lastBoundaryNavigationAtRef.current < NAVIGATION_COOLDOWN_MS) {
        return false;
      }
      lastBoundaryNavigationAtRef.current = now;
      boundaryNavigationUntilRef.current = now + NAVIGATION_COOLDOWN_MS;
      return true;
    };

    const canLeaveTop = () => {
      const reachedAt = reachedTopAtRef.current;
      return reachedAt > 0 && Date.now() - reachedAt >= BOUNDARY_READ_DELAY_MS;
    };

    let upNotches = 0;
    let upNotchGestureId = -1;
    const wheelHandler = (event: WheelEvent) => {
      const gesture = trackWheelGesture(event, scrollRef.current);
      if (disabled) {
        return;
      }
      if (event.target instanceof Element && event.target.closest(".audio-reciters")) {
        return;
      }
      if (Math.abs(event.deltaY) < 8) {
        return;
      }

      if (
        event.deltaY < 0 &&
        isScrollNearTop() &&
        !isFirst &&
        gesture.startedAtTop &&
        !gesture.consumed &&
        canLeaveTop()
      ) {
        // A mouse needs a few deliberate notches up at the top; one notch is just "scroll up".
        if (gesture.mouse) {
          if (upNotchGestureId !== gesture.id) {
            upNotchGestureId = gesture.id;
            upNotches = 0;
          }
          upNotches += 1;
          if (upNotches < MOUSE_NOTCHES_TO_NAVIGATE) return;
        }
        if (!canNavigate()) return;
        consumeWheelGesture(gesture.id);
        onPrevious();
      }
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (disabled) {
        return;
      }
      touchStartY = event.touches[0].clientY;
      touchStartedAtTop = isScrollNearTop();
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (disabled) {
        return;
      }
      const touch = event.changedTouches[0];
      if (!touch) {
        return;
      }

      const diff = touchStartY - touch.clientY;
      if (Math.abs(diff) >= SWIPE_TRIGGER_DISTANCE && canNavigate()) {
        if (diff < 0 && touchStartedAtTop && isScrollNearTop() && !isFirst && canLeaveTop()) {
          onPrevious();
        }
      }
    };

    root.addEventListener("touchstart", handleTouchStart, { passive: true });
    root.addEventListener("touchend", handleTouchEnd, { passive: true });
    root.addEventListener("wheel", wheelHandler, { passive: true });

    return () => {
      root.removeEventListener("touchstart", handleTouchStart);
      root.removeEventListener("touchend", handleTouchEnd);
      root.removeEventListener("wheel", wheelHandler);
    };
  }, [scrollRef, rootRef, poemId, isFirst, disabled, onPrevious]);

  // Track when the reader reached the top, so a scroll that merely arrives there doesn't also leave.
  useEffect(() => {
    const poemText = scrollRef.current;
    if (!poemText) return;

    const updateReachedTop = () => {
      const threshold = Math.min(
        Math.max(EDGE_THRESHOLD_PX, poemText.clientHeight * 0.05),
        64,
      );
      const atTop = poemText.scrollTop <= threshold;
      if (atTop && reachedTopAtRef.current === 0) {
        reachedTopAtRef.current = Date.now();
      } else if (!atTop) {
        reachedTopAtRef.current = 0;
      }
    };

    let animationFrameId: number | null = null;
    updateReachedTop();

    const handleScroll = () => {
      if (animationFrameId !== null) return;
      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = null;
        updateReachedTop();
      });
    };

    poemText.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      poemText.removeEventListener("scroll", handleScroll);
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
    };
  }, [scrollRef, poemId]);
}
