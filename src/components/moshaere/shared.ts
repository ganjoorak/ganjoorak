"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AccountError, fetchAccount, type AccountUser } from "@/utils/accountApi";
import { cn } from "@/lib/utils";
import type { Match, MatchTeam, TurnSeconds } from "@/utils/moshaereApi";
import { formatPersianNumber } from "@/utils/searchText";

const CHIP_TONES = {
  muted: "bg-muted text-muted-foreground",
  strong: "bg-foreground/10 text-foreground",
  primary: "bg-primary text-primary-foreground",
  positive: "bg-primary/10 text-primary",
  negative: "bg-destructive/10 text-destructive",
  urgent: "bg-destructive text-destructive-foreground",
} as const;

/** The app's small pill (counts, letters, results): one shape, a few token-based tones. */
export const chipClass = (tone: keyof typeof CHIP_TONES = "muted", className?: string) =>
  cn(
    "inline-flex shrink-0 items-center justify-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
    CHIP_TONES[tone],
    className,
  );

export const errorText = (error: unknown) =>
  error instanceof AccountError ? error.message : "خطایی رخ داد. دوباره امتحان کنید.";

export const isAuthError = (error: unknown) => error instanceof AccountError && error.status === 401;

export const TURN_LABELS: Record<TurnSeconds, string> = {
  30: "۳۰ ثانیه",
  60: "۱ دقیقه",
  180: "۳ دقیقه",
  86400: "۱ روز",
};

const count = (value: number) => formatPersianNumber(value);

/** Players who still take part (everyone but those who declined). */
export const activePlayers = (team: MatchTeam) => team.players.filter((player) => player.state !== "declined");

export const joinedPlayers = (team: MatchTeam) => team.players.filter((player) => player.state === "joined");

/** «۲ در برابر ۳», counted from my team's side (the host's side when I am only a spectator). */
export const sizeLabel = (match: Match) => {
  const mine = Math.max(match.myTeam, 0);
  return `${count(activePlayers(match.teams[mine]).length)} در برابر ${count(activePlayers(match.teams[1 - mine]).length)}`;
};

/** The other team's index from my point of view. */
export const otherTeam = (match: Match) => (match.myTeam === 0 ? 1 : 0);

/** «تیم شما» / «تیم حریف» (team 1 / 2 for someone who is not on either). */
export const teamName = (match: Match, team: number) =>
  match.myTeam < 0 ? `تیم ${count(team + 1)}` : team === match.myTeam ? "تیم شما" : "تیم حریف";

/** Both teams are on the field of a pending match: it may be started early. */
export const canStart = (match: Match) =>
  match.status === "pending" && match.teams.every((team) => joinedPlayers(team).length > 0);

/** It is my team's turn and I am still in the match. */
export const isMyTurn = (match: Match) =>
  match.status === "active" && match.myTeam >= 0 && match.turnTeam === match.myTeam && match.myState === "joined";

/** Names of a team as «الف، ب و ۲ نفر دیگر». */
export const namesOf = (team: MatchTeam, max = 2) => {
  const names = activePlayers(team).map((player) => player.displayName);
  if (names.length <= max) return names.join("، ");
  return `${names.slice(0, max).join("، ")} و ${count(names.length - max)} نفر دیگر`;
};

/** username -> team index, for tinting moves (players who left stay in their team). */
export const teamIndexByUser = (match: Match) => {
  const result: Record<string, number> = {};
  match.teams.forEach((team, index) => team.players.forEach((player) => (result[player.username] = index)));
  return result;
};

// Who is signed in, asked once per page load and shared by the room and the matches.
export type ViewerState = { status: "loading" } | { status: "out" } | { status: "in"; user: AccountUser };

let viewerRequest: Promise<AccountUser | null> | null = null;

const loadViewer = () => {
  viewerRequest ??= fetchAccount()
    .then((body) => body.user)
    .catch((error) => {
      viewerRequest = null;
      if (isAuthError(error)) return null;
      throw error;
    });
  return viewerRequest;
};

export function useViewer(): ViewerState {
  const [viewer, setViewer] = useState<ViewerState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    loadViewer()
      .then((user) => !cancelled && setViewer(user ? { status: "in", user } : { status: "out" }))
      // The service is unreachable: let people read, the composer will report the error itself.
      .catch(() => !cancelled && setViewer({ status: "out" }));
    return () => {
      cancelled = true;
    };
  }, []);
  return viewer;
}

/**
 * Calls `callback` every `ms` while enabled and the tab is visible: the next
 * tick is scheduled after the previous call settles, so slow responses never
 * pile up. Coming back to the tab polls right away.
 */
export function useVisibleInterval(callback: () => Promise<unknown> | void, ms: number, enabled: boolean) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return;
    let timer: number | null = null;
    let stopped = false;

    const clear = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };
    const schedule = () => {
      clear();
      if (stopped || document.hidden) return;
      timer = window.setTimeout(tick, ms);
    };
    const tick = async () => {
      timer = null;
      try {
        await callbackRef.current();
      } catch {
        // Polling errors are not worth interrupting anyone for; the next tick retries.
      }
      schedule();
    };
    const onVisibility = () => {
      if (document.hidden) {
        clear();
      } else {
        void tick();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    schedule();
    return () => {
      stopped = true;
      clear();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ms, enabled]);
}

/** A boolean kept in localStorage; storage may be unavailable, so it only ever remembers. */
export function usePersistedFlag(key: string, initial = false) {
  const [value, setValue] = useState(initial);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored !== null) setValue(stored === "1");
    } catch {
      // Blocked storage: keep the default.
    }
  }, [key]);

  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // Not remembered, still works for this visit.
      }
    },
    [key],
  );

  return [value, update] as const;
}

/** Newest move id in a list, 0 for none. */
export const lastId = (moves: { id: number }[]) => (moves.length > 0 ? moves[moves.length - 1].id : 0);

/** Appends moves the list does not have yet (polling can overlap a post); ids are unique. */
export const mergeMoves = <T extends { id: number }>(current: T[], incoming: T[]): T[] => {
  const known = new Map(current.map((move) => [move.id, move]));
  let changed = false;
  for (const move of incoming) {
    if (!known.has(move.id)) {
      known.set(move.id, move);
      changed = true;
    }
  }
  return changed ? Array.from(known.values()).sort((a, b) => a.id - b.id) : current;
};

export const nearBottom = () =>
  document.documentElement.scrollHeight - (window.scrollY + window.innerHeight) < 260;

export const scrollToBottom = (smooth: boolean) =>
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: smooth ? "smooth" : "auto" });
