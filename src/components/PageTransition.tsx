"use client";

import * as React from "react";
import { useLayoutEffect, type ComponentType, type ReactNode } from "react";

// React 19.3 (bundled by Next) ships <ViewTransition>; the installed
// @types/react predates it, so read it off the module.
type ViewTransitionProps = {
  children: ReactNode;
  enter?: string;
  exit?: string;
  update?: string;
  default?: string;
};
const ViewTransition = (
  React as unknown as { ViewTransition?: ComponentType<ViewTransitionProps> }
).ViewTransition;

// Back/forward: React flushes transitions started inside popstate
// synchronously (so scroll restoration works), and synchronous updates never
// start a view transition. Remember the pop, and let the page that mounts for
// it fade itself in instead (`data-nav-pop` in globals.css).
const POP_WINDOW_MS = 1500;
let popAt = -Infinity;

if (typeof window !== "undefined") {
  window.addEventListener("popstate", (event) => {
    // The browser's own swipe-back animation already covers this one.
    const uaAnimated = (event as PopStateEvent & { hasUAVisualTransition?: boolean })
      .hasUAVisualTransition;
    popAt = uaAnimated ? -Infinity : performance.now();
  });
}

function playPopEnter() {
  if (performance.now() - popAt > POP_WINDOW_MS) return;
  popAt = -Infinity;

  const root = document.documentElement;
  root.removeAttribute("data-nav-pop");
  // Restart the animation if the previous one hasn't finished.
  void root.offsetWidth;
  root.setAttribute("data-nav-pop", "");
  window.setTimeout(() => root.removeAttribute("data-nav-pop"), 400);
}

/**
 * Used as a route template: Next remounts it when the route segment below
 * changes, so the incoming page fades up and the outgoing one fades out
 * (CSS in globals.css, `page-enter` / `page-exit`). Updates inside a page
 * (search typing, feed paging via history.pushState) never animate here.
 */
export default function PageTransition({ children }: { children: ReactNode }) {
  // Before paint, so the restored page never shows a frame unanimated.
  useLayoutEffect(playPopEnter, []);

  if (!ViewTransition) return children;
  return (
    <ViewTransition enter="page-enter" exit="page-exit" default="none">
      {children}
    </ViewTransition>
  );
}
