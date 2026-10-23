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
const EDGE_PX = 2;

let lastEventAt = -Infinity;
let lastEvent: WheelEvent | null = null;
let gestureId = 0;
let startedAtTop = false;
let startedAtBottom = false;
let consumedGestureId = -1;

const atTop = (el: HTMLElement) => el.scrollTop <= EDGE_PX;
const atBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight <= EDGE_PX;

/** Call from every wheel listener (any order); the first call per event updates the gesture state. */
export function trackWheelGesture(event: WheelEvent, scroller: HTMLElement | null) {
  if (event !== lastEvent) {
    lastEvent = event;
    const now = event.timeStamp;
    if (now - lastEventAt > GESTURE_GAP_MS) {
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
  };
}

/** Mark the current gesture as used for a navigation; returns false if it already was. */
export function consumeWheelGesture(id: number) {
  if (consumedGestureId === id) return false;
  consumedGestureId = id;
  return true;
}

export const WHEEL_GESTURE_EDGE_PX = EDGE_PX;
