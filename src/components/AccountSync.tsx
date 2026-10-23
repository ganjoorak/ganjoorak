"use client";

import { useEffect, useRef, useState } from "react";
import { useSettings } from "@/context/SettingsContext";
import { saveAccountData, type AccountData } from "@/utils/accountApi";
import {
  LIBRARY_CHANGE_EVENT,
  readFavorites,
  readHistory,
  writeLibrary,
} from "@/utils/poemLibrary";
import { logger } from "@/utils/logger";

// Several feed swipes in a row become one request.
const PUSH_DELAY_MS = 3000;

/**
 * Keeps a logged-in user's library and settings in their account. On load it
 * merges this device's data with the account (union, nothing is dropped) and
 * writes the result back locally; after that every local change is pushed.
 * Logged out, the first request answers 401 and nothing else happens.
 */
export default function AccountSync() {
  const { settings, isHydrated, setFollowedPoetKeys, setInterestKeys } =
    useSettings();
  const [isSynced, setIsSynced] = useState(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const readLocalData = (): AccountData => ({
    favorites: readFavorites(),
    history: readHistory(),
    followedPoetKeys: settingsRef.current.followedPoetKeys,
    interestKeys: settingsRef.current.hasChosenInterests
      ? settingsRef.current.interestKeys
      : [],
  });

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    let cancelled = false;
    saveAccountData(readLocalData(), true)
      .then(({ data }) => {
        if (cancelled) {
          return;
        }
        writeLibrary(data.favorites, data.history);
        setFollowedPoetKeys(data.followedPoetKeys);
        if (data.interestKeys.length > 0) {
          setInterestKeys(data.interestKeys);
        }
        setIsSynced(true);
      })
      .catch((error: { status?: number }) => {
        if (error.status !== 401) {
          logger.error("Account sync failed", error);
        }
      });
    return () => {
      cancelled = true;
    };
    // Runs once per page load after settings hydrate; later changes are pushed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated]);

  useEffect(() => {
    if (!isSynced) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const push = (keepalive = false) => {
      timer = null;
      saveAccountData(readLocalData(), false, keepalive).catch((error) =>
        logger.error("Account push failed", error),
      );
    };
    const schedule = () => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(push, PUSH_DELAY_MS);
    };
    // Don't lose a pending change when the tab closes.
    const flush = () => {
      if (timer) {
        clearTimeout(timer);
        push(true);
      }
    };

    schedule();
    window.addEventListener(LIBRARY_CHANGE_EVENT, schedule);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener(LIBRARY_CHANGE_EVENT, schedule);
      window.removeEventListener("pagehide", flush);
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [isSynced, settings.followedPoetKeys, settings.interestKeys]);

  return null;
}
