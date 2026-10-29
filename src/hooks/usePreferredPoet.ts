"use client";

import { useCallback } from "react";
import { useSettings } from "@/context/SettingsContext";

/**
 * Preference state for one poet: «علاقه‌مندم».
 *
 * Preferred poets live in `settings.preferredPoetKeys` (`source:slug`), which is
 * persisted to localStorage and, when the reader is signed in, merged into the
 * account data on the Go backend by <AccountSync>. They only shape this reader's
 * home «علاقه‌مندی‌ها» tab; the «همه» feed ignores them. Nobody is notified and
 * nobody sees the list, which is why it is not a follow: following is for people
 * (see useFollowUser).
 */
export const buildPoetKey = (source: string, slug: string) =>
  `${source || "ganjoor"}:${slug.replace(/^\/+|\/+$/g, "")}`;

export function usePreferredPoet(poetKey: string) {
  const { settings, setPreferredPoetKeys } = useSettings();
  const isPreferred = settings.preferredPoetKeys.includes(poetKey);

  const togglePreferred = useCallback(() => {
    const current = settings.preferredPoetKeys;
    setPreferredPoetKeys(
      current.includes(poetKey)
        ? current.filter((key) => key !== poetKey)
        : [...current, poetKey],
    );
  }, [poetKey, setPreferredPoetKeys, settings.preferredPoetKeys]);

  return { isPreferred, togglePreferred };
}

export function usePreferredPoetKeys() {
  const { settings, setPreferredPoetKeys } = useSettings();
  const remove = useCallback(
    (key: string) =>
      setPreferredPoetKeys(
        settings.preferredPoetKeys.filter((value) => value !== key),
      ),
    [setPreferredPoetKeys, settings.preferredPoetKeys],
  );
  return { keys: settings.preferredPoetKeys, remove };
}
