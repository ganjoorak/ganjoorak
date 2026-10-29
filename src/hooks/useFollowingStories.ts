"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { isPersonSeen, markSeen, readSeen, type SeenMap } from "@/components/stories/storyState";
import { useAccountSession } from "@/hooks/useAccountSession";
import { fetchFollowingQuotes, type StoryPerson } from "@/utils/quotesApi";

// «Stories»: followed people who shared poem lines in the last 7 days. The menu button (dot) and the menu
// (avatar row) both read this, so the answer and the per-device seen state live in one small shared store
// instead of each caller fetching and holding its own copy.

const CACHE_TTL_MS = 2 * 60_000;

interface Snapshot {
  /** Whose answer `people` is, so one account's stories never show for another. */
  owner: string | null;
  people: StoryPerson[];
  /** null until localStorage is read, so seen people never flash as unseen. */
  seen: SeenMap | null;
}

const EMPTY: Snapshot = { owner: null, people: [], seen: null };

let snapshot: Snapshot = EMPTY;
let fetchedAt = 0;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

const update = (next: Partial<Snapshot>) => {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => snapshot;
const getServerSnapshot = () => EMPTY;

const loadSeen = () => {
  if (snapshot.seen === null) update({ seen: readSeen() });
};

const load = (username: string) => {
  const isFresh = snapshot.owner === username && Date.now() - fetchedAt < CACHE_TTL_MS;
  if (isFresh || pending) return;
  pending = fetchFollowingQuotes()
    .then((people) => {
      fetchedAt = Date.now();
      update({ owner: username, people });
    })
    .catch(() => undefined)
    .finally(() => {
      pending = null;
    });
};

/** Remembers on this device that `quoteId` of `username` was shown, so the ring turns grey everywhere. */
export const markStorySeen = (username: string, quoteId: number) => update({ seen: markSeen(username, quoteId) });

/**
 * Followed people with a fragment from the last week, unseen first (each group newest first), for the
 * signed-in reader; empty when signed out, while loading, or when nobody shared anything.
 * `refresh` re-asks when the answer is older than two minutes (call it when the menu opens).
 */
export function useFollowingStories() {
  const { user } = useAccountSession();
  const username = user?.username ?? null;
  const { owner, people: fetched, seen } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(loadSeen, []);

  useEffect(() => {
    if (username) load(username);
  }, [username]);

  const people = useMemo(() => {
    if (!username || owner !== username || !seen) return [];
    const withQuotes = fetched.filter((person) => person.quotes.length > 0);
    const byNewest = (a: StoryPerson, b: StoryPerson) => b.latestAt - a.latestAt;
    const unseen = withQuotes.filter((person) => !isPersonSeen(person, seen)).sort(byNewest);
    const read = withQuotes.filter((person) => isPersonSeen(person, seen)).sort(byNewest);
    return [...unseen, ...read];
  }, [fetched, owner, seen, username]);

  const isUnseen = (person: StoryPerson) => (seen ? !isPersonSeen(person, seen) : false);
  const unseenCount = people.filter(isUnseen).length;

  return {
    people,
    isUnseen,
    unseenCount,
    hasUnseen: unseenCount > 0,
    refresh: () => {
      if (username) load(username);
    },
  };
}
