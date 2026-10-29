"use client";

import { useCallback, useSyncExternalStore } from "react";
import { latestUpdateVersion } from "@/data/updates";
import { logger } from "@/utils/logger";

const STORAGE_KEY = "ganjoorak:lastSeenUpdate";

// One shared answer: the menu's dot and the settings sheet's «بروزرسانی‌ها» row both read it, so marking the
// updates as read in one place clears the cue in the other without a reload.
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
};

const getSnapshot = () => {
  try {
    return Boolean(latestUpdateVersion) && window.localStorage.getItem(STORAGE_KEY) !== latestUpdateVersion;
  } catch (error) {
    logger.error("Failed to read updates status", error);
    return false;
  }
};

const getServerSnapshot = () => false;

export const useUpdateNotification = () => {
  const hasNewUpdates = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const markAsRead = useCallback(() => {
    try {
      if (latestUpdateVersion) {
        window.localStorage.setItem(STORAGE_KEY, latestUpdateVersion);
      }
    } catch (error) {
      logger.error("Failed to mark updates as read", error);
    }
    listeners.forEach((listener) => listener());
  }, []);

  return { hasNewUpdates, markAsRead, latestUpdateVersion };
};
