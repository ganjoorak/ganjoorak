/**
 * One shared view of wheel/touchpad gestures for every listener that turns a wheel at a poem's edge into
 * navigation (pull-to-next, previous at the top).
 *
 * A touchpad fling arrives as a long stream of small wheel events with an inertia tail. Events less than
 * GESTURE_GAP_MS apart belong to the same gesture. A gesture may only navigate if the poem was already at
 * that edge when the gesture began (so the tail of the scroll that *reached* the edge never navigates), and
 * each gesture may navigate at most once (so the tail after a navigation never navigates again).
 */
const GESTURE_GAP_MS = 200;
/**
 * A mouse wheel sends discrete notches (deltaY ~100/120 px, or a few lines in Firefox) that can be 30-400ms
 * apart. Treating each notch as its own gesture made the pull spring back between notches and let a single
 * notch at an edge navigate, so mouse-style streams use a longer gap.
 */
const MOUSE_GESTURE_GAP_MS = 400;
const NOTCH_MIN_PX = 50;
const EDGE_PX = 2;

let lastEventAt = -Infinity;
let lastEvent: WheelEvent | null = null;
let gestureId = 0;
let startedAtTop = false;
let startedAtBottom = false;
let consumedGestureId = -1;
let mouseLike = false;

/** deltaMode lines/pages, or a large delta that starts a stream or follows a mouse notch, reads as a notch. */
const looksLikeNotch = (event: WheelEvent, gapMs: number) => {
  if (event.deltaMode !== 0) return true;
  if (Math.abs(event.deltaY) < NOTCH_MIN_PX) return false;
  return mouseLike || gapMs >= 28;
};

const atTop = (el: HTMLElement) => el.scrollTop <= EDGE_PX;
const atBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight <= EDGE_PX;

/** Call from every wheel listener (any order); the first call per event updates the gesture state. */
export function trackWheelGesture(event: WheelEvent, scroller: HTMLElement | null) {
  if (event !== lastEvent) {
    lastEvent = event;
    const now = event.timeStamp;
    const gap = now - lastEventAt;
    mouseLike = looksLikeNotch(event, gap);
    if (gap > (mouseLike ? MOUSE_GESTURE_GAP_MS : GESTURE_GAP_MS)) {
      gestureId += 1;
      startedAtTop = scroller ? atTop(scroller) : false;
      startedAtBottom = scroller ? atBottom(scroller) : false;
    }
    lastEventAt = now;
  }
  return {
    id: gestureId,
    startedAtTop,
    startedAtBottom,
    consumed: consumedGestureId === gestureId,
    /** This event is a discrete mouse-wheel notch (not a touchpad stream). */
    mouse: mouseLike,
  };
}

/** Mark the current gesture as used for a navigation; returns false if it already was. */
export function consumeWheelGesture(id: number) {
  if (consumedGestureId === id) return false;
  consumedGestureId = id;
  return true;
}

export const WHEEL_GESTURE_EDGE_PX = EDGE_PX;
/** Notches a mouse wheel needs to navigate (pull to next, or previous at the top). */
export const MOUSE_NOTCHES_TO_NAVIGATE = 3;
/** With a mouse, wait this long after the last notch before springing the pull sheet back. */
export const MOUSE_IDLE_MS = 380;
