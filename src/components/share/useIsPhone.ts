"use client";

import { useSyncExternalStore } from "react";

// Same breakpoint as the dialog primitive's bottom sheet (Tailwind `sm`).
const PHONE_QUERY = "(max-width: 639px)";

const subscribePhone = (callback: () => void) => {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
};

export const useIsPhone = () =>
  useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
