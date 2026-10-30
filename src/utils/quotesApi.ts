import type { AvatarValue } from "@/components/ProfileAvatar";
import { request } from "@/utils/accountApi";

// Poem fragments people share on their page. Contract:
// docs/social-api-contract.md §5.

export interface Quote {
  id: number;
  key: string;
  href: string;
  poetName: string;
  poemTitle: string;
  /** 0-based inclusive line indices into /api/poem-lines. */
  from: number;
  to: number;
  /** Cut by the server from the real poem. */
  lines: string[];
  createdAt: number;
}

export interface StoryPerson {
  user: { username: string; displayName: string; avatar: AvatarValue; accent: string };
  /** Last 7 days, newest first. */
  quotes: Quote[];
  latestAt: number;
}

export const MAX_QUOTE_LINES = 8;

export const createQuote = (key: string, from: number, to: number) =>
  request<{ quote: Quote }>("quotes", { method: "POST", json: { key, from, to } }).then((body) => body.quote);

export const deleteQuote = (id: number) => request<void>(`quotes/${id}`, { method: "DELETE" });

export const fetchUserQuotes = (username: string, before?: number) =>
  request<{ quotes: Quote[]; next: number | null }>(
    `users/${encodeURIComponent(username)}/quotes${before ? `?before=${before}` : ""}`,
  );

/** People the signed-in user follows who shared something in the last 7 days. */
export const fetchFollowingQuotes = () =>
  request<{ people: StoryPerson[] }>("following/quotes").then((body) => body.people);
