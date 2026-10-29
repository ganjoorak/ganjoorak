"use client";

import { Button } from "@/components/ui/button";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { FaLock, FaLockOpen } from "react-icons/fa";
import PoemViewer from "@/components/PoemViewer";
import type { Poem } from "@/types/poem";
import { consumeWheelGesture, MOUSE_NOTCHES_TO_NAVIGATE, trackWheelGesture } from "@/utils/wheelGesture";

const ZEN_STORAGE_KEY = "ganjoorak:zen-scroll-lock";
const STRONG_SWIPE_PX = 72;
const WHEEL_THRESHOLD_PX = 48;
const NAVIGATION_COOLDOWN_MS = 650;
const EDGE_THRESHOLD_PX = 8;
const KEY_SCROLL_AMOUNT_PX = 110;
const READING_CHROME_HIDE_MS = 850;

type Direction = "next" | "previous";

interface PoemFeedPagerProps {
  poem: Poem;
  nextPoem?: Poem;
  isFirst: boolean;
  isLast?: boolean;
  isPreparingNextPoem?: boolean;
  onNext: () => void;
  onPrevious: () => void;
  isPoetPage?: boolean;
  poetSlug?: string;
  onTogglePoetInfo?: () => void;
  onOpenFeed?: () => void;
  onOpenFeedLabel?: string;
  titleEyebrow?: ReactNode;
}

const isScrollable = (element: HTMLElement) => element.scrollHeight > element.clientHeight + 4;

const isAtTop = (element: HTMLElement) => element.scrollTop <= EDGE_THRESHOLD_PX;

const isAtBottom = (element: HTMLElement) =>
  element.scrollHeight - element.scrollTop - element.clientHeight <= EDGE_THRESHOLD_PX;

const getPoemText = (target: EventTarget | null) => {
  if (!(target instanceof Element)) return null;
  return target.closest(".poem-text") as HTMLElement | null;
};

const getActivePoemText = (root: HTMLElement | null) =>
  root?.querySelector(".poem-text") as HTMLElement | null;

const isShareDialogOpen = () =>
  Boolean(document.querySelector(".lyrics-share-panel"));

export default function PoemFeedPager({
  poem,
  nextPoem,
  isFirst,
  isLast = false,
  isPreparingNextPoem = false,
  onNext,
  onPrevious,
  isPoetPage = false,
  poetSlug,
  onTogglePoetInfo,
  onOpenFeed,
  onOpenFeedLabel,
  titleEyebrow,
}: PoemFeedPagerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const touchStartYRef = useRef(0);
  const touchPoemTextRef = useRef<HTMLElement | null>(null);
  const touchStartedAtTopRef = useRef(false);
  const touchStartedAtBottomRef = useRef(false);
  const lastNavigationAtRef = useRef(0);
  const readingChromeTimeoutRef = useRef<number | null>(null);
  const [isZenLocked, setIsZenLocked] = useState(false);
  // Direction of the last navigation, whatever started it (buttons, wheel, swipe, keys, pull sheet), so
  // PoemViewer animates the old poem out and the new one in the right way.
  const [navigationDirection, setNavigationDirection] = useState<Direction | null>(null);

  useEffect(() => {
    setIsZenLocked(localStorage.getItem(ZEN_STORAGE_KEY) === "1");
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("poem-zen-mode", isZenLocked);
    localStorage.setItem(ZEN_STORAGE_KEY, isZenLocked ? "1" : "0");
  }, [isZenLocked]);

  useEffect(() => {
    const updateAudioClass = () => {
      document.documentElement.classList.toggle(
        "poem-feed-has-audio-player",
        Boolean(rootRef.current?.querySelector(".audio-player")),
      );
    };

    updateAudioClass();
    const observer = new MutationObserver(updateAudioClass);
    if (rootRef.current) {
      observer.observe(rootRef.current, { childList: true, subtree: true });
    }

    return () => {
      observer.disconnect();
      document.documentElement.classList.remove("poem-feed-has-audio-player");
    };
  }, [poem.id]);

  const resetTitleVisibility = useCallback(() => {
    rootRef.current
      ?.querySelectorAll(".poem-content--title-hidden")
      .forEach((element) => {
        element.classList.remove("poem-content--title-hidden");
      });
  }, []);

  const resetArm = useCallback(() => {
    document.documentElement.classList.remove("poem-feed-boundary-armed");
  }, []);

  const updateTitleVisibility = useCallback((poemText: HTMLElement) => {
    const poemContent = poemText.closest(".poem-content");
    if (!poemContent) return;

    poemContent.classList.remove("poem-content--title-hidden");
  }, []);

  const hideReadingChromeTemporarily = useCallback(() => {
    document.documentElement.classList.add("poem-feed-is-reading");

    if (readingChromeTimeoutRef.current !== null) {
      window.clearTimeout(readingChromeTimeoutRef.current);
    }

    readingChromeTimeoutRef.current = window.setTimeout(() => {
      document.documentElement.classList.remove("poem-feed-is-reading");
      readingChromeTimeoutRef.current = null;
    }, READING_CHROME_HIDE_MS);
  }, []);

  const canNavigate = useCallback(() => {
    const now = Date.now();
    if (now - lastNavigationAtRef.current < NAVIGATION_COOLDOWN_MS) {
      return false;
    }

    lastNavigationAtRef.current = now;
    return true;
  }, []);

  // PoemViewer's AnimatePresence plays the old poem's exit and the new one's entrance in this direction.
  const navigate = useCallback((direction: Direction) => {
    if (isZenLocked || isShareDialogOpen() || !canNavigate()) return;
    if (direction === "next" ? isLast : isFirst) return;

    resetArm();
    resetTitleVisibility();
    setNavigationDirection(direction);
    if (direction === "next") onNext();
    else onPrevious();
  }, [
    canNavigate,
    isFirst,
    isLast,
    isZenLocked,
    onNext,
    onPrevious,
    resetArm,
    resetTitleVisibility,
  ]);

  const requestBoundaryNavigation = useCallback((direction: Direction) => {
    if (isZenLocked) return;
    navigate(direction);
  }, [isZenLocked, navigate]);

  useEffect(() => {
    resetArm();
    resetTitleVisibility();
    document.documentElement.classList.remove("poem-feed-is-reading");

    const poemText = getActivePoemText(rootRef.current);
    if (poemText) {
      poemText.scrollTop = 0;
      updateTitleVisibility(poemText);
    }
  }, [poem.id, resetArm, resetTitleVisibility, updateTitleVisibility]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const stop = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    const handlePoemScroll = (event: Event) => {
      if (isShareDialogOpen()) return;
      // The reciters list scrolls on its own; a wheel over it never navigates.
      if (event.target instanceof Element && event.target.closest(".audio-reciters")) return;

      const poemText = getPoemText(event.target);
      if (!poemText) return;

      updateTitleVisibility(poemText);
      hideReadingChromeTemporarily();
    };

    // Passive: wheel/touchpad scrolling inside the poem stays native. "Next" belongs to the pull sheet
    // (usePullToNext); "previous" needs a fresh gesture that began at the top, and fires once per gesture.
    let upwardTotal = 0;
    let upwardGestureId = -1;
    const handleWheel = (event: WheelEvent) => {
      if (isShareDialogOpen()) return;

      const poemText = getPoemText(event.target) ?? getActivePoemText(root);
      const gesture = trackWheelGesture(event, poemText);
      if (!poemText) return;

      updateTitleVisibility(poemText);
      hideReadingChromeTemporarily();

      const deltaY = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      if (deltaY >= 0) return;

      if (!gesture.startedAtTop || gesture.consumed || !(isAtTop(poemText) || !isScrollable(poemText))) {
        return;
      }
      if (upwardGestureId !== gesture.id) {
        upwardGestureId = gesture.id;
        upwardTotal = 0;
      }
      // A mouse notch is ~100px, so one notch alone would pass the touchpad threshold: count notches instead.
      upwardTotal += gesture.mouse ? WHEEL_THRESHOLD_PX / MOUSE_NOTCHES_TO_NAVIGATE + 0.01 : -deltaY;
      // Keep PoemViewer's own boundary handler out of this gesture.
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (upwardTotal < WHEEL_THRESHOLD_PX) return;
      consumeWheelGesture(gesture.id);
      requestBoundaryNavigation("previous");
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (isShareDialogOpen()) return;

      const poemText = getPoemText(event.target);
      const touch = event.touches[0];
      if (!poemText || !touch) return;

      updateTitleVisibility(poemText);
      hideReadingChromeTemporarily();
      touchPoemTextRef.current = poemText;
      touchStartYRef.current = touch.clientY;
      touchStartedAtTopRef.current = isAtTop(poemText);
      touchStartedAtBottomRef.current = isAtBottom(poemText);
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (isShareDialogOpen()) return;

      const poemText = touchPoemTextRef.current;
      const touch = event.changedTouches[0];
      touchPoemTextRef.current = null;

      if (!poemText || !touch) return;

      updateTitleVisibility(poemText);
      hideReadingChromeTemporarily();
      const diff = touchStartYRef.current - touch.clientY;
      if (Math.abs(diff) < STRONG_SWIPE_PX) return;

      const canScrollInside = isScrollable(poemText);
      const shouldGoNext = diff > 0 && (!canScrollInside || (touchStartedAtBottomRef.current && isAtBottom(poemText)));
      const shouldGoPrevious = diff < 0 && (!canScrollInside || (touchStartedAtTopRef.current && isAtTop(poemText)));

      if (!shouldGoNext && !shouldGoPrevious) {
        resetArm();
        return;
      }

      if (shouldGoNext) {
        // PoemViewer's pull-to-next owns this gesture (the next poem follows the finger).
        return;
      }

      stop(event);
      requestBoundaryNavigation("previous");
    };

    root.addEventListener("scroll", handlePoemScroll, { capture: true, passive: true });
    root.addEventListener("wheel", handleWheel, { capture: true, passive: true });
    root.addEventListener("touchstart", handleTouchStart, { capture: true, passive: true });
    root.addEventListener("touchend", handleTouchEnd, { capture: true, passive: false });

    return () => {
      root.removeEventListener("scroll", handlePoemScroll, true);
      root.removeEventListener("wheel", handleWheel, true);
      root.removeEventListener("touchstart", handleTouchStart, true);
      root.removeEventListener("touchend", handleTouchEnd, true);
    };
  }, [hideReadingChromeTemporarily, requestBoundaryNavigation, resetArm, updateTitleVisibility]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isShareDialogOpen()) return;

      if (event.defaultPrevented) return;
      if (event.altKey || event.metaKey || event.ctrlKey) return;
      if (event.code !== "ArrowDown" && event.code !== "ArrowUp") return;

      const target = event.target as Element | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) {
        return;
      }

      const poemText = getActivePoemText(rootRef.current);
      if (!poemText) return;

      updateTitleVisibility(poemText);
      hideReadingChromeTemporarily();
      const direction: Direction = event.code === "ArrowDown" ? "next" : "previous";
      const canScrollInside = isScrollable(poemText);
      const shouldNavigate = direction === "next"
        ? !canScrollInside || isAtBottom(poemText)
        : !canScrollInside || isAtTop(poemText);

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (!shouldNavigate) {
        poemText.scrollBy({
          top: direction === "next" ? KEY_SCROLL_AMOUNT_PX : -KEY_SCROLL_AMOUNT_PX,
          behavior: "smooth",
        });
        resetArm();
        return;
      }

      requestBoundaryNavigation(direction);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [hideReadingChromeTemporarily, requestBoundaryNavigation, resetArm, updateTitleVisibility]);

  useEffect(() => {
    return () => {
      document.documentElement.classList.remove("poem-feed-is-reading", "poem-feed-has-audio-player");
      if (readingChromeTimeoutRef.current !== null) {
        window.clearTimeout(readingChromeTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div ref={rootRef} className="poem-feed-pager">
      <style>{`
        .poem-feed-pager {
          position: fixed;
          inset: 0;
          overflow: hidden;
          background: rgb(var(--background));
          touch-action: pan-y;
          isolation: isolate;
        }

        .poem-feed-viewer {
          position: absolute;
          inset: 0;
          background: rgb(var(--background));
        }

        .poem-feed-viewer .poem-viewer {
          background: rgb(var(--background));
        }

        .poem-feed-viewer .poem-text {
          scrollbar-width: thin;
          scrollbar-color: rgb(var(--foreground) / 0.24) transparent;
          scrollbar-gutter: stable;
        }

        .poem-feed-viewer .poem-text::-webkit-scrollbar {
          width: 0.45rem;
        }

        .poem-feed-viewer .poem-text::-webkit-scrollbar-track {
          background: transparent;
        }

        .poem-feed-viewer .poem-text::-webkit-scrollbar-thumb {
          min-height: 3rem;
          border: 2px solid transparent;
          border-radius: 999px;
          background-clip: padding-box;
          background-color: rgb(var(--foreground) / 0.22);
        }

        .poem-feed-viewer .poem-text::-webkit-scrollbar-thumb:hover {
          background-color: rgb(var(--foreground) / 0.34);
        }

        .poem-feed-lock-button {
          position: fixed !important;
          top: 7rem !important;
          right: 1rem !important;
          width: 2.5rem !important;
          height: 2.5rem !important;
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .poem-feed-lock-button:hover {
        }

        .poem-feed-lock-button.is-active {
        }

        .poem-feed-lock-button svg {
          width: 1rem;
          height: 1rem;
        }

        .poem-zen-mode .navigation-controls,
        .poem-zen-mode .action-buttons,
        .poem-zen-mode .global-search-button,
        .poem-zen-mode .menu-button {
          opacity: 0 !important;
          pointer-events: none !important;
        }

        /* ⌃/⌄ stay put through every poem change: above the pull-to-next sheet (z-index 5), like the pinned
           title chip, so the sheet never slides over them. */
        .poem-feed-pager .navigation-controls {
          z-index: 6;
        }

        @media (max-width: 768px) {
          .poem-feed-pager .navigation-controls,
          .poem-feed-pager .action-buttons {
            transition: opacity 0.2s ease;
          }

          .poem-feed-pager .poem-text {
            padding-top: clamp(8.5rem, 24vh, 10.75rem) !important;
          }

          .poem-feed-pager .poem-content--centered .poem-text {
            padding-top: clamp(8.5rem, 24vh, 10.75rem) !important;
          }

          .poem-feed-pager .poem-content--title-hidden .poem-text,
          .poem-feed-pager .poem-content--centered.poem-content--title-hidden .poem-text {
            padding-top: 4.25rem !important;
          }

          .poem-feed-pager .poem-content--has-eyebrow .poem-text,
          .poem-feed-pager .poem-content--has-eyebrow.poem-content--centered .poem-text {
            padding-top: calc(clamp(9.75rem, 26vh, 11.25rem) + env(safe-area-inset-top)) !important;
          }

          .poem-feed-pager .title-section {
            max-height: 9.75rem;
            overflow: hidden;
          }

          .poem-feed-pager .poem-content--has-eyebrow .title-section {
            max-height: 12.25rem;
          }

          .poem-feed-viewer .poem-text {
            scrollbar-width: thin;
            scrollbar-color: rgb(var(--foreground) / 0.28) transparent;
          }

          .poem-feed-viewer .poem-text::-webkit-scrollbar {
            width: 0.35rem;
          }

          .poem-feed-lock-button {
            top: auto !important;
            right: 1rem !important;
            bottom: calc(7.5rem + env(safe-area-inset-bottom)) !important;
          }
        }

        @media (max-width: 480px) {
          .poem-feed-pager .poem-text,
          .poem-feed-pager .poem-content--centered .poem-text {
            padding-top: clamp(8rem, 24vh, 10rem) !important;
          }

          .poem-feed-pager .poem-content--title-hidden .poem-text,
          .poem-feed-pager .poem-content--centered.poem-content--title-hidden .poem-text {
            padding-top: 4rem !important;
          }

          .poem-feed-pager .poem-content--has-eyebrow .poem-text,
          .poem-feed-pager .poem-content--has-eyebrow.poem-content--centered .poem-text {
            padding-top: calc(clamp(9.25rem, 26vh, 10.75rem) + env(safe-area-inset-top)) !important;
          }

          .poem-feed-pager .title-section {
            max-height: 9rem;
          }

          .poem-feed-pager .poem-content--has-eyebrow .title-section {
            max-height: 11.5rem;
          }
        }
      `}</style>
      <div className="poem-feed-viewer">
        <PoemViewer
          poem={poem}
          onNext={(target) => {
            // The pull sheet passes the poem it showed; only advance if that is still the feed's next poem.
            if (target && target.id !== nextPoem?.id) return;
            requestBoundaryNavigation("next");
          }}
          onPrevious={() => requestBoundaryNavigation("previous")}
          isFirst={isFirst}
          isLast={isLast}
          isModern={poem.source !== "ganjoor"}
          poetSlug={poetSlug}
          isPoetPage={isPoetPage}
          onTogglePoetInfo={onTogglePoetInfo}
          onOpenFeed={onOpenFeed}
          onOpenFeedLabel={onOpenFeedLabel}
          titleEyebrow={titleEyebrow}
          navigationDirection={navigationDirection}
          isZenLocked={isZenLocked}
          onToggleZenLock={() => setIsZenLocked((value) => !value)}
          nextPoemPeek={nextPoem}
          isPreparingNext={isPreparingNextPoem}
        />
      </div>
      <Button
        type="button"
        variant={isZenLocked ? "default" : "outline"}
        size="icon"
        className={`poem-feed-lock-button rounded-full shadow-sm${isZenLocked ? " is-active" : ""}`}
        onClick={() => setIsZenLocked((value) => !value)}
        aria-pressed={isZenLocked}
        aria-label={isZenLocked ? "باز کردن اسکرول شعر بعدی" : "قفل کردن اسکرول روی همین شعر"}
        title={isZenLocked ? "قفل اسکرول روشن است" : "قفل اسکرول روی همین شعر"}
      >
        {isZenLocked ? <FaLock aria-hidden="true" /> : <FaLockOpen aria-hidden="true" />}
      </Button>
    </div>
  );
}
