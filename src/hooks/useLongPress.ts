"use client";

import type React from "react";
import { useEffect, useRef } from "react";

export const LONG_PRESS_MS = 450;

/** Tap and long-press on one button: the tap never fires after a long-press, no context menu. */
export function useLongPress(onLongPress: () => void, onTap: () => void) {
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const didLongPressRef = useRef(false);

  const clear = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => clear, []);

  const end = () => {
    startRef.current = null;
    clear();
  };

  return {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      didLongPressRef.current = false;
      startRef.current = { x: event.clientX, y: event.clientY };
      clear();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        didLongPressRef.current = true;
        navigator.vibrate?.(10);
        onLongPress();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      const start = startRef.current;
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) clear();
    },
    onPointerUp: end,
    onPointerLeave: end,
    onPointerCancel: end,
    onContextMenu: (event: React.MouseEvent<HTMLElement>) => event.preventDefault(),
    onClick: () => {
      if (didLongPressRef.current) {
        didLongPressRef.current = false;
        return;
      }
      onTap();
    },
  };
}
