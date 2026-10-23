"use client";

import type React from "react";
import { useEffect } from "react";

const CLASS_NAME = "floating-controls-hidden";
const THRESHOLD_PX = 10;
const EDGE_PX = 24;

/** Mobile: toggles a class on <html> that hides floating controls while scrolling down. */
export function useHideOnScroll(ref: React.RefObject<HTMLElement | null>, resetKey: unknown) {
  useEffect(() => {
    const element = ref.current;
    const root = document.documentElement;
    if (!element) return;
    let lastTop = element.scrollTop;
    const setHidden = (hidden: boolean) => root.classList.toggle(CLASS_NAME, hidden);

    const handleScroll = () => {
      const top = element.scrollTop;
      const atTop = top <= EDGE_PX;
      const atBottom = element.scrollHeight - element.clientHeight - top <= EDGE_PX;
      if (atTop || atBottom) {
        setHidden(false);
        lastTop = top;
        return;
      }
      const delta = top - lastTop;
      if (Math.abs(delta) < THRESHOLD_PX) return;
      lastTop = top;
      const overlayOpen = document.querySelector('[data-slot="drawer-popup"], [data-slot="dialog-popup"]');
      setHidden(delta > 0 && !overlayOpen && window.matchMedia("(max-width: 600px)").matches);
    };

    setHidden(false);
    element.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", handleScroll);
      setHidden(false);
    };
  }, [ref, resetKey]);
}
