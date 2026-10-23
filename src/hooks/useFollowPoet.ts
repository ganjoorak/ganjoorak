"use client";

import { useCallback } from "react";
import { useSettings } from "@/context/SettingsContext";

/**
 * Follow state for one poet.
 *
 * Followed poets live in `settings.followedPoetKeys` (`source:slug`), which is
 * persisted to localStorage and, when the reader is signed in, merged into the
 * account data on the Go backend by <AccountSync>. The home feed already reads
 * the same list, so following a poet also biases the feed toward them.
 */
export const buildPoetFollowKey = (source: string, slug: string) =>
  `${source || "ganjoor"}:${slug.replace(/^\/+|\/+$/g, "")}`;

export function useFollowPoet(followKey: string) {
  const { settings, setFollowedPoetKeys } = useSettings();
  const isFollowing = settings.followedPoetKeys.includes(followKey);

  const toggleFollow = useCallback(() => {
    const current = settings.followedPoetKeys;
    setFollowedPoetKeys(
      current.includes(followKey)
        ? current.filter((key) => key !== followKey)
        : [...current, followKey],
    );
  }, [followKey, setFollowedPoetKeys, settings.followedPoetKeys]);

  return { isFollowing, toggleFollow };
}

export function useFollowedPoetKeys() {
  const { settings, setFollowedPoetKeys } = useSettings();
  const unfollow = useCallback(
    (key: string) =>
      setFollowedPoetKeys(
        settings.followedPoetKeys.filter((value) => value !== key),
      ),
    [setFollowedPoetKeys, settings.followedPoetKeys],
  );
  return { keys: settings.followedPoetKeys, unfollow };
}
