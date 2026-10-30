import type { AvatarValue } from "@/components/ProfileAvatar";
import { request, type FeedbackKind, type StaffRole } from "@/utils/accountApi";
import type { Quote } from "@/utils/quotesApi";

// The admin dashboard's calls (backend/admin*.go). Every rule is enforced there:
// what the pages hide or disable is only a courtesy.

/** One page of a list; pass next as `before` for the following one. */
export interface AdminPage<T> {
  items: T[];
  next: number | null;
}

export interface AdminWindow {
  day: number;
  week: number;
  month: number;
}

export interface TrendDay {
  /** YYYY-MM-DD, a Tehran calendar day. */
  day: string;
  signups: number;
  active: number;
  quotes: number;
  moves: number;
  matches: number;
}

export interface AdminOverview {
  users: number;
  publicUsers: number;
  bannedUsers: number;
  staff: number;
  signups: AdminWindow;
  active: AdminWindow;
  quotes: number;
  newQuotes: AdminWindow;
  moves: number;
  newMoves: AdminWindow;
  matches: number;
  activeMatches: number;
  openFeedback: number;
  /** The last 30 days, oldest first, without gaps. */
  trend: TrendDay[];
}

export interface AdminUser {
  id: number;
  username: string;
  displayName: string;
  avatar: AvatarValue;
  role: StaffRole;
  isPublic: boolean;
  createdAt: number;
  /** 0 when not banned. */
  bannedAt: number;
}

export interface AuditEntry {
  id: number;
  /** 0 for the server command. */
  actorId: number;
  actorUsername: string;
  action: string;
  targetId: number;
  targetUsername: string;
  objectId: number;
  reason: string;
  /** What the action changed or removed; its shape depends on the action. */
  detail: Record<string, unknown>;
  createdAt: number;
}

export interface AdminUserDetail extends AdminUser {
  bio: string;
  banner: string;
  hasRecoveryCode: boolean;
  readingAt: number;
  sessions: number;
  quotes: number;
  moves: number;
  reads: number;
  followers: number;
  following: number;
  audit: AuditEntry[];
}

export interface AdminFeedback {
  id: number;
  kind: FeedbackKind;
  message: string;
  contact: string;
  /** As the client sent it; never link it unchecked. */
  page: string;
  username: string;
  userId: number;
  createdAt: number;
  reviewedAt: number;
  reviewedBy: string;
}

export interface AdminProfile {
  id: number;
  username: string;
  displayName: string;
  avatar: AvatarValue;
  banner: string;
  bio: string;
  role: StaffRole;
  createdAt: number;
}

export type AdminQuote = Quote & {
  userId: number;
  username: string;
  displayName: string;
  role: StaffRole;
};

export interface AdminMove {
  id: number;
  userId: number;
  username: string;
  displayName: string;
  role: StaffRole;
  lines: string[];
  typed: boolean;
  poetName: string;
  poemTitle: string;
  createdAt: number;
}

export type ClearableField = "avatar" | "banner" | "bio" | "displayName";

const query = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) search.set(key, String(value));
  });
  const text = search.toString();
  return text ? `?${text}` : "";
};

/** 401 signed out, 403 for regular accounts. */
export const fetchAdminSession = () => request<{ role: StaffRole; openFeedback: number }>("admin/session");

export const fetchAdminOverview = () =>
  request<{ overview: AdminOverview }>("admin/overview").then((body) => body.overview);

export const fetchAdminUsers = (params: { q?: string; filter?: string; before?: number }) =>
  request<AdminPage<AdminUser>>(`admin/users${query(params)}`);

export const fetchAdminUser = (id: number) =>
  request<{ user: AdminUserDetail }>(`admin/users/${id}`).then((body) => body.user);

export const banUser = (id: number, reason: string) =>
  request<void>(`admin/users/${id}/ban`, { method: "POST", json: { reason } });

export const unbanUser = (id: number, reason: string) =>
  request<void>(`admin/users/${id}/unban`, { method: "POST", json: { reason } });

export const revokeUserSessions = (id: number, reason: string) =>
  request<void>(`admin/users/${id}/revoke-sessions`, { method: "POST", json: { reason } });

export const setUserRole = (id: number, role: StaffRole, reason: string) =>
  request<void>(`admin/users/${id}/role`, { method: "PUT", json: { role, reason } });

export const fetchAdminFeedback = (params: { status?: string; kind?: string; before?: number }) =>
  request<AdminPage<AdminFeedback>>(`admin/feedback${query(params)}`);

export const setFeedbackReviewed = (id: number, reviewed: boolean) =>
  request<void>(`admin/feedback/${id}/reviewed`, { method: "PUT", json: { reviewed } });

export const fetchAdminProfiles = (params: { q?: string; has?: string; before?: number }) =>
  request<AdminPage<AdminProfile>>(`admin/content/profiles${query(params)}`);

export const fetchAdminQuotes = (params: { q?: string; before?: number }) =>
  request<AdminPage<AdminQuote>>(`admin/content/quotes${query(params)}`);

export const fetchAdminMoves = (params: { q?: string; typed?: string; before?: number }) =>
  request<AdminPage<AdminMove>>(`admin/content/moves${query(params)}`);

export const removeQuote = (id: number, reason: string) =>
  request<void>(`admin/content/quotes/${id}/remove`, { method: "POST", json: { reason } });

export const removeMove = (id: number, reason: string) =>
  request<void>(`admin/content/moves/${id}/remove`, { method: "POST", json: { reason } });

export const clearProfileField = (id: number, field: ClearableField, reason: string) =>
  request<void>(`admin/content/users/${id}/clear`, { method: "POST", json: { field, reason } });

export const fetchAdminAudit = (params: { action?: string; before?: number }) =>
  request<AdminPage<AuditEntry>>(`admin/audit${query(params)}`);
