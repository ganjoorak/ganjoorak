"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import ProfileAvatar from "@/components/ProfileAvatar";
import { buttonVariants } from "@/components/ui/button";
import { firstUnseenIndex, formatStoryTime, personAccent } from "@/components/stories/storyState";
import { publicProfilePath } from "@/utils/accountApi";
import type { Quote, StoryPerson } from "@/utils/quotesApi";
import { formatPersianNumber } from "@/utils/searchText";
import "@/styles/stories.css";

/** How long each quote stays; the progress bar's CSS animation uses the same number. */
export const STORY_DURATION_MS = 7000;
const HOLD_MS = 220;
const DISMISS_DRAG_PX = 110;
const DRAG_START_PX = 10;
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface StoryViewerProps {
  /** Shown in this order; after the last quote of one person comes the next person. */
  people: StoryPerson[];
  startIndex: number;
  /** Called for every quote shown, so the ring can turn grey. */
  onSeen: (username: string, quoteId: number) => void;
  onClose: () => void;
}

// The API sends newest first; a story reads oldest to newest.
const chronological = (person: StoryPerson): Quote[] => [...person.quotes].sort((a, b) => a.id - b.id);

/**
 * Full-screen viewer of a followed person's recent quotes: segmented progress bars, auto-advance, hold to
 * pause, tap the halves to move (in RTL the left half is forward), swipe down / Escape / ✕ to leave.
 */
export default function StoryViewer({ people, startIndex, onSeen, onClose }: StoryViewerProps) {
  const [personIndex, setPersonIndex] = useState(startIndex);
  const person = people[personIndex];
  const quotes = useMemo(() => chronological(person), [person]);
  // Starts at the first quote not seen yet, like the ring's colour promises.
  const [quoteIndex, setQuoteIndex] = useState(() => firstUnseenIndex(people[startIndex]));
  const [isHeld, setIsHeld] = useState(false);
  const [isHidden, setIsHidden] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const gesture = useRef<{ x: number; y: number; pointerId: number; held: boolean; dragging: boolean } | null>(null);
  const holdTimer = useRef<number | null>(null);

  useEffect(() => setContainer(document.body), []);

  const quote = quotes[Math.min(quoteIndex, quotes.length - 1)];
  const accent = personAccent(person);
  const isPaused = isHeld || isHidden || isDragging;

  useEffect(() => {
    if (quote) onSeen(person.user.username, quote.id);
    // onSeen is stable enough; the story is "seen" per shown quote.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.id, person.user.username]);

  const goToPerson = useCallback(
    (index: number, atEnd: boolean) => {
      const target = people[index];
      setPersonIndex(index);
      setQuoteIndex(atEnd ? Math.max(0, target.quotes.length - 1) : firstUnseenIndex(target));
    },
    [people],
  );

  const next = useCallback(() => {
    if (quoteIndex < quotes.length - 1) setQuoteIndex(quoteIndex + 1);
    else if (personIndex < people.length - 1) goToPerson(personIndex + 1, false);
    else onClose();
  }, [goToPerson, onClose, people.length, personIndex, quoteIndex, quotes.length]);

  const previous = useCallback(() => {
    if (quoteIndex > 0) setQuoteIndex(quoteIndex - 1);
    else if (personIndex > 0) goToPerson(personIndex - 1, true);
    else setQuoteIndex(0);
  }, [goToPerson, personIndex, quoteIndex]);

  // Focus moves in on open and back to the story button on close.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    const onVisibility = () => setIsHidden(document.visibilityState !== "visible");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // On `document`, bubbling: runs before the poem viewer's window listeners (arrows, space) and stops them.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!["Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " ", "Tab"].includes(event.key)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        next(); // RTL: left is forward.
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        previous();
      } else if (event.key === " " && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        setIsHeld((value) => !value);
      } else if (event.key === "Tab") {
        const focusable = Array.from(rootRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!rootRef.current?.contains(document.activeElement)) {
          event.preventDefault();
          first.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
      event.stopPropagation();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [next, onClose, previous]);

  const clearHold = () => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };
  useEffect(() => clearHold, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || gesture.current) return;
    gesture.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, held: false, dragging: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    clearHold();
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null;
      if (gesture.current) {
        gesture.current.held = true;
        setIsHeld(true);
      }
    }, HOLD_MS);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    const dy = event.clientY - g.y;
    if (!g.dragging && dy > DRAG_START_PX && dy > Math.abs(event.clientX - g.x)) {
      g.dragging = true;
      clearHold();
      setIsDragging(true);
    }
    if (g.dragging) setDragY(Math.max(0, dy));
  };

  const endGesture = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    gesture.current = null;
    clearHold();
    setIsHeld(false);
    if (g.dragging) {
      setIsDragging(false);
      if (!cancelled && dragY > DISMISS_DRAG_PX) onClose();
      else setDragY(0);
      return;
    }
    if (cancelled || g.held) return;
    const box = event.currentTarget.getBoundingClientRect();
    // RTL: the left half is forward.
    if (event.clientX < box.left + box.width / 2) next();
    else previous();
  };

  // Keyboard clicks (detail 0) on the invisible tap zones; pointer taps are handled above.
  const zoneClick = (action: () => void) => (event: ReactMouseEvent) => {
    if (event.detail === 0) action();
  };

  if (!container || !quote) return null;

  const isClassical = quote.key.startsWith("ganjoor:");
  const style = {
    ...(accent ? { "--story-accent": accent } : null),
    transform: dragY ? `translateY(${dragY}px)` : undefined,
    opacity: dragY ? Math.max(0.35, 1 - dragY / 420) : undefined,
    transition: isDragging ? "none" : undefined,
  } as CSSProperties;

  return createPortal(
    <div
      ref={rootRef}
      className="gk-story"
      role="dialog"
      aria-modal="true"
      aria-label={`بیت‌های ${person.user.displayName}`}
      data-story-viewer
      dir="rtl"
      style={style}
    >
      <div className="gk-story__card">
        <div className="gk-story__bars" aria-hidden="true">
          {quotes.map((item, index) => (
            <span key={item.id} className="gk-story__bar">
              <span
                key={index === quoteIndex ? `${person.user.username}-${item.id}-active` : "static"}
                className="gk-story__bar-fill"
                data-state={index < quoteIndex ? "done" : index === quoteIndex ? "active" : "todo"}
                data-paused={isPaused || undefined}
                onAnimationEnd={index === quoteIndex ? next : undefined}
              />
            </span>
          ))}
        </div>

        <header className="gk-story__header">
          <Link href={publicProfilePath(person.user.username)} className="gk-story__person" onClick={onClose}>
            <ProfileAvatar username={person.user.username} avatar={person.user.avatar} className="gk-story__avatar" decorative />
            <span className="gk-story__who">
              <span className="gk-story__name">{person.user.displayName}</span>
              <time className="gk-story__time" dateTime={new Date(quote.createdAt).toISOString()}>
                {formatStoryTime(quote.createdAt)}
              </time>
            </span>
          </Link>
          <button
            ref={closeRef}
            type="button"
            className={buttonVariants({ variant: "ghost", size: "icon-lg", className: "gk-story__close" })}
            aria-label="بستن"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div
          className="gk-story__stage"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => endGesture(event, false)}
          onPointerCancel={(event) => endGesture(event, true)}
        >
          <button type="button" className="gk-story__zone gk-story__zone--start" aria-label="بیت قبلی" onClick={zoneClick(previous)} />
          <button type="button" className="gk-story__zone gk-story__zone--end" aria-label="بیت بعدی" onClick={zoneClick(next)} />
          <blockquote className="gk-story__quote" key={quote.id}>
            {quote.lines.map((line, index) => (
              <p
                key={index}
                className="gk-story__line"
                data-couplet-end={isClassical && (quote.from + index) % 2 === 1 ? "" : undefined}
              >
                {line}
              </p>
            ))}
          </blockquote>
          <p className="gk-story__sr" aria-live="polite">
            {`بیت ${formatPersianNumber(quoteIndex + 1)} از ${formatPersianNumber(quotes.length)}`}
          </p>
        </div>

        <footer className="gk-story__footer">
          <Link
            href={quote.href}
            className={buttonVariants({ variant: "outline", size: "lg", className: "gk-story__source" })}
            onClick={onClose}
          >
            {quote.poetName} · {quote.poemTitle}
          </Link>
        </footer>
      </div>
    </div>,
    container,
  );
}
