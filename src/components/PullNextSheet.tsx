"use client";

import React, { forwardRef } from "react";

interface PullNextSheetProps {
  /**
   * Which edge the sheet waits behind: "bottom" (default) for the next poem, which slides up; "top" for the
   * previous poem, which slides down. The grab handle sits on the leading edge, so at the bottom of a top sheet.
   */
  edge?: "bottom" | "top";
  isPreparing?: boolean;
  /** The live view's .poem-content / .poem-text classes, so the sheet lays out exactly like the poem it becomes. */
  contentClassName: string;
  textClassName: string;
  /** The sheet's .poem-text, so the viewer can measure its poem's own layout (stacked mesras). */
  textRef?: React.Ref<HTMLDivElement>;
  /** The sheet poem's body, rendered by PoemViewer with the same markup as the live poem (no entrance animations). */
  children?: React.ReactNode;
}

/**
 * The next (or previous) poem, laid out exactly like the live view, waiting just outside the viewport inside the
 * viewer (under the floating controls). usePullToNext slides it in; when it covers the screen it is
 * pixel-identical to the poem that lands, so swapping to the real view is invisible.
 */
const PullNextSheet = forwardRef<HTMLDivElement, PullNextSheetProps>(function PullNextSheet(
  { edge = "bottom", isPreparing = false, contentClassName, textClassName, textRef, children },
  ref,
) {
  return (
    <>
      <div className="gk-pull-scrim" aria-hidden="true" />
      <div ref={ref} className={edge === "top" ? "gk-pull-sheet gk-pull-sheet--top" : "gk-pull-sheet"} aria-hidden="true" inert>
        {/* Only a grab handle: the poem's own header sits right below it, exactly where it will land. */}
        <div className="gk-pull-grip">
          <div className="gk-pull-handle" />
          {!children && isPreparing && <div className="gk-pull-label">در حال آماده‌سازی…</div>}
        </div>
        <div className={contentClassName}>
          <div className="poem-navigation-frame">
            <div ref={textRef} className={textClassName}>{children}</div>
          </div>
        </div>
      </div>
    </>
  );
});

export default PullNextSheet;
