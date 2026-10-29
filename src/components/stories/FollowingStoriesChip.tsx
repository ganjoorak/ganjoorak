"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import ProfileAvatar from "@/components/ProfileAvatar";
import StoryViewer from "@/components/stories/StoryViewer";
import {
  isPersonSeen,
  markSeen,
  personAccent,
  readSeen,
  type SeenMap,
} from "@/components/stories/storyState";
import { buttonVariants } from "@/components/ui/button";
import { useAccountSession } from "@/hooks/useAccountSession";
import { cn } from "@/lib/utils";
import { fetchFollowingQuotes, type StoryPerson } from "@/utils/quotesApi";
import { formatPersianNumber } from "@/utils/searchText";
import "@/styles/stories.css";

// Remounts of the home page (it swaps trees between poem, loading and empty states) reuse the last answer
// instead of making the chip pop in again.
const CACHE_TTL_MS = 2 * 60_000;
let cache: { at: number; people: StoryPerson[] } | null = null;

/** Avatars shown in the stack; the rest is a count. */
const MAX_AVATARS = 3;

/**
 * A floating chip for the home feed: a small stack of the avatars of followed people with a fragment the
 * reader has not seen yet, each ringed in the person's accent. Tapping it opens the StoryViewer at the first
 * unseen person. Renders nothing when signed out, while loading, or when everything is seen: no placeholder.
 * It lives with the app's other floating buttons (see `.gk-story-chip` in stories.css).
 */
export default function FollowingStoriesChip() {
  const { isSignedIn } = useAccountSession();
  const [people, setPeople] = useState<StoryPerson[]>(() => (cache && Date.now() - cache.at < CACHE_TTL_MS ? cache.people : []));
  // null until localStorage is read, so seen people never flash as unseen.
  const [seen, setSeen] = useState<SeenMap | null>(null);
  const [viewer, setViewer] = useState<StoryPerson[] | null>(null);

  useEffect(() => setSeen(readSeen()), []);

  useEffect(() => {
    if (!isSignedIn) return;
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) return;
    let cancelled = false;
    fetchFollowingQuotes()
      .then((next) => {
        cache = { at: Date.now(), people: next };
        if (!cancelled) setPeople(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isSignedIn]);

  // Newest first: the first one is where the viewer starts.
  const unseen = useMemo(
    () =>
      seen
        ? people
            .filter((person) => person.quotes.length > 0 && !isPersonSeen(person, seen))
            .sort((a, b) => b.latestAt - a.latestAt)
        : [],
    [people, seen],
  );

  const showChip = isSignedIn && unseen.length > 0 && !viewer;
  const first = unseen[0];
  const extra = unseen.length - MAX_AVATARS;
  const label =
    unseen.length === 1
      ? `بیت‌های تازهٔ ${first?.user.displayName}`
      : `بیت‌های تازهٔ ${formatPersianNumber(unseen.length)} نفر از دنبال‌شده‌ها`;

  return (
    <>
      {showChip && (
        <button
          type="button"
          className={cn(buttonVariants({ variant: "outline" }), "gk-story-chip rounded-full shadow-sm")}
          aria-label={label}
          title={label}
          onClick={() => setViewer(unseen)}
        >
          <span className="gk-story-chip__stack" aria-hidden="true">
            {unseen.slice(0, MAX_AVATARS).map((person) => {
              const accent = personAccent(person);
              return (
                <span
                  key={person.user.username}
                  className="gk-story-chip__ring"
                  style={accent ? ({ "--story-accent": accent } as CSSProperties) : undefined}
                >
                  <ProfileAvatar
                    username={person.user.username}
                    avatar={person.user.avatar}
                    className="gk-story-chip__avatar"
                    decorative
                  />
                </span>
              );
            })}
          </span>
          {extra > 0 && (
            <span className="gk-story-chip__count" aria-hidden="true">
              +{formatPersianNumber(extra)}
            </span>
          )}
        </button>
      )}
      {viewer && (
        <StoryViewer
          people={viewer}
          startIndex={0}
          onSeen={(username, quoteId) => setSeen(markSeen(username, quoteId))}
          onClose={() => setViewer(null)}
        />
      )}
    </>
  );
}
