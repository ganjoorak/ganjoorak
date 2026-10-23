"use client";

import React, { forwardRef, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Poem } from "@/types/poem";

interface PullNextSheetProps {
  nextPoem?: Poem | null;
  isPreparing?: boolean;
}

const PEEK_LINES = 8;

/** The next poem's title and first lines; usePullToNext slides it up from below the viewport. */
const PullNextSheet = forwardRef<HTMLDivElement, PullNextSheetProps>(function PullNextSheet(
  { nextPoem, isPreparing = false },
  ref,
) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const lines = nextPoem
    ? nextPoem.plainText.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, PEEK_LINES)
    : [];
  const subtitle = nextPoem
    ? (nextPoem.fullTitle || "").split(" » ").filter((part) => part.trim()).slice(0, -1).join("، ") ||
      nextPoem.poetNickname ||
      nextPoem.poet
    : "";

  return createPortal(
    <>
      <div className="gk-pull-scrim" aria-hidden="true" />
      <div ref={ref} className="gk-pull-sheet" aria-hidden="true" dir="rtl">
        <div className="gk-pull-handle" />
        <div className="gk-pull-label">
          <span className="gk-pull-label-idle">شعر بعدی</span>
          <span className="gk-pull-label-armed">رها کنید</span>
        </div>
        {nextPoem ? (
          <>
            <h2 className="gk-pull-title">{nextPoem.title}</h2>
            {subtitle && <div className="gk-pull-subtitle">{subtitle}</div>}
            <div className="gk-pull-lines">
              {lines.map((line, index) => (
                <p key={index} className="gk-pull-line">{line}</p>
              ))}
            </div>
          </>
        ) : (
          <div className="gk-pull-subtitle">{isPreparing ? "در حال آماده‌سازی…" : ""}</div>
        )}
      </div>
    </>,
    document.body,
  );
});

export default PullNextSheet;
