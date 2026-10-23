import type { PoemLibraryEntry } from "@/utils/poemLibrary";

// Thin client for the Go accounts service (backend/), reached same-origin
// through the /api/account rewrite in next.config.js.

export interface AccountUser {
  username: string;
  displayName: string;
  createdAt: number;
}

export interface AccountData {
  favorites: PoemLibraryEntry[];
  history: PoemLibraryEntry[];
  followedPoetKeys: string[];
  interestKeys: string[];
}

export class AccountError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const FALLBACK_ERROR = "ارتباط با سرور برقرار نشد. دوباره امتحان کنید.";

const request = async <T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> => {
  const { json, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(`/api/account/${path}`, {
      ...rest,
      credentials: "same-origin",
      cache: "no-store",
      headers: json === undefined ? undefined : { "Content-Type": "application/json" },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
  } catch {
    throw new AccountError(FALLBACK_ERROR, 0);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const body = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok || !body) {
    throw new AccountError(body?.error || FALLBACK_ERROR, response.status);
  }
  return body;
};

export const fetchAccount = () =>
  request<{ user: AccountUser; data: AccountData }>("me");

export const signUp = (username: string, password: string, displayName: string) =>
  request<{ user: AccountUser }>("signup", {
    method: "POST",
    json: { username, password, displayName },
  });

export const logIn = (username: string, password: string) =>
  request<{ user: AccountUser }>("login", {
    method: "POST",
    json: { username, password },
  });

export const logOut = () => request<void>("logout", { method: "POST" });

export const saveAccountData = (
  data: AccountData,
  merge: boolean,
  keepalive = false,
) =>
  request<{ data: AccountData }>("data", {
    method: "PUT",
    json: { data, merge },
    keepalive,
  });
