"use client";

import { createElement, useEffect } from "react";
import type { Poem } from "@/types/poem";
import { badgeIcon } from "@/components/badges/badgeIcons";
import { toast } from "@/components/toast/toastStore";
import { getAccountSession, markStreakToday } from "@/utils/accountSession";
import { getPoemLibraryKey } from "@/utils/poemLibrary";
import { reportRead, type Badge, type Streak } from "@/utils/progressApi";
import { formatPersianNumber } from "@/utils/searchText";

/** A poem counts after this much time on screen (docs/social-api-contract.md §1)... */
export const READ_AFTER_VISIBLE_MS = 15_000;
/** ...or when the reader scrolls to its end, as long as they did not just flick past. */
const END_MIN_VISIBLE_MS = 4_000;
const END_EDGE_PX = 8;
const TICK_MS = 500;

// Once per poem per page view; the server also dedupes per day.
const reportedKeys = new Set<string>();

const announce = (streak: Streak, newBadges: Badge[], hadStreakToday: boolean | null) => {
  newBadges.forEach((badge) => {
    const Icon = badgeIcon(badge.icon);
    toast({
      title: `نشان تازه: ${badge.title}`,
      description: badge.description,
      tone: "celebrate",
      icon: createElement(Icon),
      action: { label: "دیدن نشان‌ها", href: "/profile" },
      duration: 7000,
    });
  });
  // Badges already celebrate the streak; the small toast is for the ordinary first read of a day.
  if (newBadges.length === 0 && hadStreakToday === false && streak.today && streak.current >= 2) {
    toast({ title: `🔥 ${formatPersianNumber(streak.current)} روز پیاپی`, duration: 3500 });
  }
};

const report = async (key: string) => {
  const session = await getAccountSession();
  if (!session.user) return;
  reportedKeys.add(key);
  try {
    const { streak, newBadges } = await reportRead(key);
    markStreakToday();
    announce(streak, newBadges, session.streakToday);
  } catch {
    // Silent: a lost read only means a missed streak day.
  }
};

interface Options {
  poem: Poem;
  /** False while this poem is not the one being read (e.g. a dialog covers it). */
  active?: boolean;
}

/**
 * Reports a poem as read, once, when the reader has had it on screen for 15 s (time with the tab hidden does
 * not count) or has scrolled to its end. Signed out, or when the service fails, nothing happens.
 */
export function useReadTracker({ poem, active = true }: Options) {
  const key = getPoemLibraryKey(poem);
  const poemId = String(poem.id);

  useEffect(() => {
    if (!active || reportedKeys.has(key)) return;
    let visibleMs = 0;
    let reachedEnd = false;
    let done = false;
    let last = performance.now();

    const finish = () => {
      if (done) return;
      done = true;
      window.clearInterval(timer);
      void report(key);
    };
    const check = () => {
      if (visibleMs >= READ_AFTER_VISIBLE_MS || (reachedEnd && visibleMs >= END_MIN_VISIBLE_MS)) finish();
    };
    const tick = () => {
      const now = performance.now();
      // A suspended tab can wake up with a huge gap; only count a plausible slice of it.
      if (document.visibilityState === "visible") visibleMs += Math.min(now - last, TICK_MS * 4);
      last = now;
      check();
    };
    const timer = window.setInterval(tick, TICK_MS);

    const onScroll = (event: Event) => {
      const el = event.target;
      if (!(el instanceof HTMLElement) || el.getAttribute("data-poem-id") !== poemId) return;
      if (el.scrollHeight <= el.clientHeight + END_EDGE_PX) return;
      if (el.scrollHeight - el.scrollTop - el.clientHeight <= END_EDGE_PX) {
        reachedEnd = true;
        check();
      }
    };
    // Capture: scroll does not bubble. The poem scroller is `.poem-text[data-poem-id]`.
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });

    return () => {
      done = true;
      window.clearInterval(timer);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [active, key, poemId]);
}
