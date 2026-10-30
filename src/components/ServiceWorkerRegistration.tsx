"use client";

import { useEffect } from "react";

const ServiceWorkerRegistration = () => {
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      process.env.NODE_ENV !== "production"
    ) {
      return;
    }

    const register = () => {
      navigator.serviceWorker
        .register(`/sw.js?v=${process.env.NEXT_PUBLIC_BUILD_ID}`)
        .catch(() => {
          // Service worker registration is best-effort for offline shell support.
        });
    };

    // The install step precaches several pages. Wait until the page has loaded and the browser
    // is idle so that never competes with the first poem's requests.
    let idleHandle: number | undefined;
    let timerHandle: number | undefined;
    // Safari has no requestIdleCallback.
    const idleApi = window as unknown as {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    };
    const whenIdle = () => {
      if (typeof idleApi.requestIdleCallback === "function") {
        idleHandle = idleApi.requestIdleCallback(register, { timeout: 10000 });
      } else {
        timerHandle = window.setTimeout(register, 3000);
      }
    };

    if (document.readyState === "complete") {
      whenIdle();
      return () => {
        if (idleHandle !== undefined) window.cancelIdleCallback(idleHandle);
        if (timerHandle !== undefined) window.clearTimeout(timerHandle);
      };
    }

    window.addEventListener("load", whenIdle, { once: true });
    return () => {
      window.removeEventListener("load", whenIdle);
      if (idleHandle !== undefined) window.cancelIdleCallback(idleHandle);
      if (timerHandle !== undefined) window.clearTimeout(timerHandle);
    };
  }, []);

  return null;
};

export default ServiceWorkerRegistration;
