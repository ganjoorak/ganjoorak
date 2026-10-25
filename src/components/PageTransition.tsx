"use client";

import * as React from "react";
import type { ComponentType, ReactNode } from "react";

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

/**
 * Used as a route template: Next remounts it when the route segment below
 * changes, so the incoming page fades up and the outgoing one fades out
 * (CSS in globals.css, `page-enter` / `page-exit`). Updates inside a page
 * (search typing, feed paging via history.pushState) never animate here.
 */
export default function PageTransition({ children }: { children: ReactNode }) {
  if (!ViewTransition) return children;
  return (
    <ViewTransition enter="page-enter" exit="page-exit" default="none">
      {children}
    </ViewTransition>
  );
}
