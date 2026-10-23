"use client";

import React, { forwardRef } from "react";

interface PullNextSheetProps {
  isPreparing?: boolean;
  /** The live view's .poem-content / .poem-text classes, so the sheet lays out exactly like the poem it becomes. */
  contentClassName: string;
  textClassName: string;
  /** The next poem's body, rendered by PoemViewer with the same markup as the live poem (no entrance animations). */
  children?: React.ReactNode;
}

/**
 * The next poem, laid out exactly like the live view, waiting just below the viewport inside the viewer
 * (under the floating controls). usePullToNext slides it up; when it reaches the top it is pixel-identical
 * to the poem that lands, so swapping to the real view is invisible.
 */
const PullNextSheet = forwardRef<HTMLDivElement, PullNextSheetProps>(function PullNextSheet(
  { isPreparing = false, contentClassName, textClassName, children },
  ref,
) {
  return (
    <>
      <div className="gk-pull-scrim" aria-hidden="true" />
      <div ref={ref} className="gk-pull-sheet" aria-hidden="true" inert>
        {/* Only a grab handle: the poem's own header sits right below it, exactly where it will land. */}
        <div className="gk-pull-grip">
          <div className="gk-pull-handle" />
          {!children && isPreparing && <div className="gk-pull-label">در حال آماده‌سازی…</div>}
        </div>
        <div className={contentClassName}>
          <div className="poem-navigation-frame">
            <div className={textClassName}>{children}</div>
          </div>
        </div>
      </div>
    </>
  );
});

export default PullNextSheet;
