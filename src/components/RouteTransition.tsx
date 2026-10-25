"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";

export default function RouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [isNavigating, setIsNavigating] = useState(false);
  const fallbackTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setIsNavigating(false);

    if (fallbackTimerRef.current) {
      window.clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, [pathname]);

  // Safari/Chrome swipe-back plays its own animation; flag it so the page
  // transition CSS (globals.css) skips ours instead of playing both.
  useEffect(() => {
    let timer: number | null = null;
    const handlePopState = (event: PopStateEvent) => {
      if (!(event as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition) {
        return;
      }
      const root = document.documentElement;
      root.setAttribute("data-ua-transition", "");
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => root.removeAttribute("data-ua-transition"), 600);
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.button !== 0
      ) {
        return;
      }

      const anchor = (event.target as Element | null)?.closest("a");
      if (!anchor?.href || anchor.target || anchor.hasAttribute("download")) {
        return;
      }

      const nextUrl = new URL(anchor.href);
      if (nextUrl.origin !== window.location.origin) {
        return;
      }

      const currentUrl = new URL(window.location.href);
      if (
        nextUrl.pathname === currentUrl.pathname &&
        nextUrl.search === currentUrl.search
      ) {
        return;
      }

      setIsNavigating(true);
      if (fallbackTimerRef.current) {
        window.clearTimeout(fallbackTimerRef.current);
      }
      fallbackTimerRef.current = window.setTimeout(() => {
        setIsNavigating(false);
        fallbackTimerRef.current = null;
      }, 5000);
    };

    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
      if (fallbackTimerRef.current) {
        window.clearTimeout(fallbackTimerRef.current);
      }
    };
  }, []);

  return (
    <>
      <AnimatePresence>
        {isNavigating && (
          <motion.div
            className="route-progress"
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{ scaleX: 1, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
          />
        )}
      </AnimatePresence>
      {children}
    </>
  );
}
