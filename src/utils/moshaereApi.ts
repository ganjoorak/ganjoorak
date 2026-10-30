import type { AvatarValue } from "@/components/ProfileAvatar";
import { request } from "@/utils/accountApi";

// Moshaere: the public room and team matches. Contract:
// docs/social-api-contract.md §6.

/** Typed from memory, or picked from a poem (the server cuts the lines). */
export type VerseInput = { lines: string[] } | { key: string; from: number; to: number };

export interface MoshaereMove {
  id: number;
  username: string;
  displayName: string;
  avatar: AvatarValue;
  lines: string[];
  firstLetter: string;
  lastLetter: string;
  /** "" for typed verses. */
  key: string;
  href: string;
  poetName: string;
  poemTitle: string;
  createdAt: number;
  /** Taken down by a moderator: lines hold a placeholder, the letters stay so the chain still reads. */
  removed?: boolean;
}

export interface MoshaereLeader {
  username: string;
  displayName: string;
  avatar: AvatarValue;
  count: number;
}

export type PlayerState = "invited" | "joined" | "declined" | "left";

export interface MatchPlayer {
  username: string;
  displayName: string;
  avatar: AvatarValue;
  accent: string;
  state: PlayerState;
  moveCount: number;
}

export interface MatchTeam {
  players: MatchPlayer[];
  moveCount: number;
}

export type MatchStatus = "pending" | "active" | "finished" | "declined" | "cancelled";

export const TURN_SECONDS = [30, 60, 180, 86400] as const;
export type TurnSeconds = (typeof TURN_SECONDS)[number];

/** A team match: team 0 is the host's team and moves first. */
export interface Match {
  id: number;
  status: MatchStatus;
  /** Search is allowed in this match (the server rejects picked verses otherwise). */
  assist: boolean;
  turnSeconds: TurnSeconds;
  /** Username of the creator (always in team 0). */
  host: string;
  teams: [MatchTeam, MatchTeam];
  /** 0 | 1 for the caller, -1 if the caller only declined. */
  myTeam: number;
  myState: PlayerState;
  /** 0 | 1 while active, else -1. */
  turnTeam: number;
  /** ms; 0 unless active. */
  turnDeadline: number;
  nextLetter: string;
  /** 0 | 1 when finished, else -1. */
  winnerTeam: number;
  endReason: "timeout" | "resign" | "";
  /** Oldest first; [] in lists, only newer ones when fetched with `after`. */
  moves: MoshaereMove[];
  lastMove: MoshaereMove | null;
  createdAt: number;
  updatedAt: number;
  /** Server clock, for countdowns. */
  now: number;
}

export const fetchPublicRoom = (after?: number) =>
  request<{ moves: MoshaereMove[]; nextLetter: string; leaders: MoshaereLeader[] }>(
    `moshaere/public${after ? `?after=${after}` : ""}`,
  );

/**
 * `expect` is the newest move id the client has seen (0 for an empty room): when someone was faster
 * the server answers 409 (the client then refetches the room for the new letter).
 */
export const postPublicMove = (verse: VerseInput, expect?: number) =>
  request<{ move: MoshaereMove; nextLetter: string }>("moshaere/public", {
    method: "POST",
    json: expect === undefined ? verse : { ...verse, expect },
  });

export interface NewMatch {
  /** The other team, 1-5 usernames. */
  opponents: string[];
  /** Team-mates besides me, 0-4 usernames. */
  allies: string[];
  assist: boolean;
  turnSeconds: TurnSeconds;
}

export const createMatch = (match: NewMatch) =>
  request<{ match: Match }>("matches", { method: "POST", json: match }).then((body) => body.match);

export const fetchMatches = () =>
  request<{ matches: Match[]; invites: number; yourTurn: number }>("matches");

export const fetchMatch = (id: number, after?: number) =>
  request<{ match: Match }>(`matches/${id}${after ? `?after=${after}` : ""}`).then((body) => body.match);

const matchAction = (id: number, action: "accept" | "decline" | "cancel" | "start" | "leave") =>
  request<{ match: Match }>(`matches/${id}/${action}`, { method: "POST" }).then((body) => body.match);

export const acceptMatch = (id: number) => matchAction(id, "accept");
export const declineMatch = (id: number) => matchAction(id, "decline");
export const cancelMatch = (id: number) => matchAction(id, "cancel");
export const startMatch = (id: number) => matchAction(id, "start");
export const leaveMatch = (id: number) => matchAction(id, "leave");

export const postMatchMove = (id: number, verse: VerseInput) =>
  request<{ match: Match }>(`matches/${id}/moves`, { method: "POST", json: verse }).then((body) => body.match);
