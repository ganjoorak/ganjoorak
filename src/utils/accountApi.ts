import type { AvatarKey } from "@/components/ProfileAvatar";
import type { CollectionEntry } from "@/utils/collectionLibrary";
import type { PoemLibraryEntry } from "@/utils/poemLibrary";

// Thin client for the Go accounts service (backend/), reached same-origin
// through the /api/account rewrite in next.config.js.

export interface AccountUser {
  username: string;
  displayName: string;
  createdAt: number;
  /** Whether /@username is visible to others. */
  isPublic: boolean;
  /** Chosen profile picture motif; "" picks one from the username. */
  avatar: AvatarKey | "";
  /** False for accounts made before recovery codes existed. */
  hasRecoveryCode: boolean;
}

/**
 * What anyone sees at /@username (GET /api/account/users/:username). The
 * service builds it from an allow-list: no preferred poets, no full history.
 */
export interface PublicProfile {
  username: string;
  displayName: string;
  avatar: AvatarKey | "";
  createdAt: number;
  /** Set while the owner opened this poem in the last ~20 minutes. */
  nowReading: PoemLibraryEntry | null;
  lastPoem: PoemLibraryEntry | null;
  /** Newest liked poems, capped by the service; see favoriteCount. */
  favorites: PoemLibraryEntry[];
  favoriteCount: number;
  /** Books the owner loves, newest first, capped by the service. */
  lovedCollections: CollectionEntry[];
  /** Only public accounts are counted on either side. */
  followerCount: number;
  followingCount: number;
}

export interface AccountData {
  favorites: PoemLibraryEntry[];
  history: PoemLibraryEntry[];
  lovedCollections: CollectionEntry[];
  preferredPoetKeys: string[];
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

/** Public accounts only, on the other side of each count; see followCounts in the backend. */
export interface FollowCounts {
  followers: number;
  following: number;
}

/** One row of the owner's followers / following list. */
export interface FollowedUser {
  username: string;
  displayName: string;
  avatar: AvatarKey | "";
  followedAt: number;
}

export const fetchAccount = () =>
  request<{ user: AccountUser; data: AccountData; follows: FollowCounts }>("me");

// Following is between people. Poets are not followed: see usePreferredPoet.

/** 401 when signed out. */
export const fetchFollowState = (username: string) =>
  request<{ following: boolean }>(`follow/${encodeURIComponent(username)}`).then((body) => body.following);

export const followUser = (username: string) =>
  request<{ following: boolean }>(`follow/${encodeURIComponent(username)}`, { method: "PUT" });

export const unfollowUser = (username: string) =>
  request<{ following: boolean }>(`follow/${encodeURIComponent(username)}`, { method: "DELETE" });

/** The signed-in user's own lists; other people's are not public, only their counts. */
export const fetchFollowList = (kind: "following" | "followers") =>
  request<{ users: FollowedUser[] }>(kind).then((body) => body.users);

/** The recovery code in the answer is shown to the user once and never again. */
export const signUp = (username: string, password: string, displayName: string) =>
  request<{ user: AccountUser; recoveryCode: string }>("signup", {
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

export const setProfileVisibility = (isPublic: boolean) =>
  request<{ user: AccountUser }>("visibility", {
    method: "PUT",
    json: { isPublic },
  });

/** Forgot password: the code is used up and a new one comes back to show once. */
export const resetPassword = (username: string, recoveryCode: string, newPassword: string) =>
  request<{ user: AccountUser; recoveryCode: string }>("reset", {
    method: "POST",
    json: { username, recoveryCode, newPassword },
  });

export const changePassword = (currentPassword: string, newPassword: string) =>
  request<{ user: AccountUser }>("password", {
    method: "PUT",
    json: { currentPassword, newPassword },
  });

export const createRecoveryCode = (password: string) =>
  request<{ user: AccountUser; recoveryCode: string }>("recovery-code", {
    method: "POST",
    json: { password },
  });

export const updateProfile = (profile: { username: string; displayName: string; avatar: AvatarKey | "" }) =>
  request<{ user: AccountUser }>("profile", { method: "PUT", json: profile });

/** The shareable address of a profile, e.g. /@hadi (rewritten to /u/hadi). */
export const publicProfilePath = (username: string) => `/@${username}`;

export type FeedbackKind = "suggestion" | "bug" | "other";

/** Works signed out too; with a session the service stores the username alongside. */
export const sendFeedback = (feedback: {
  kind: FeedbackKind;
  message: string;
  contact: string;
  page: string;
}) => request<void>("feedback", { method: "POST", json: feedback });
