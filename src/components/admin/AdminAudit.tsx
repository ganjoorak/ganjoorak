"use client";

import Link from "next/link";
import { Chip, ROLE_LABELS } from "@/components/admin/AdminParts";
import { formatRelativeTime } from "@/components/profile/profileFormat";
import type { StaffRole } from "@/utils/accountApi";
import type { AuditEntry } from "@/utils/adminApi";

export const AUDIT_ACTIONS: Record<string, string> = {
  ban: "مسدودسازی",
  unban: "رفع مسدودی",
  revoke_sessions: "خروج از نشست‌ها",
  set_role: "تغییر نقش",
  remove_quote: "حذف تکه",
  remove_move: "حذف بیت",
  clear_profile: "پاک‌سازی نمایه",
};

const FIELD_LABELS: Record<string, string> = {
  avatar: "تصویر نمایه",
  banner: "بنر",
  bio: "معرفی",
  displayName: "نام نمایشی",
};

/** Plain text of what an entry changed; its detail is whatever the action stored. */
const detailText = ({ action, detail }: AuditEntry) => {
  if (action === "set_role") {
    const label = (value: unknown) => ROLE_LABELS[(typeof value === "string" ? value : "") as StaffRole] ?? "";
    return `${label(detail.from)} ← ${label(detail.to)}`;
  }
  if (action === "clear_profile") {
    const field = FIELD_LABELS[String(detail.field)] ?? "";
    const old = typeof detail.old === "string" && !detail.old.startsWith("img:") ? `: ${detail.old}` : "";
    return `${field}${old}`;
  }
  return Array.isArray(detail.lines) ? detail.lines.join(" / ") : "";
};

export default function AuditRow({ entry }: { entry: AuditEntry }) {
  const text = detailText(entry);
  return (
    <div className="admin-card">
      <div className="admin-card-head">
        <Chip>{AUDIT_ACTIONS[entry.action] ?? entry.action}</Chip>
        <span className="app-row-meta">
          <bdi dir="ltr">{entry.actorId ? `@${entry.actorUsername}` : "سرور"}</bdi>
          {entry.targetUsername && (
            <>
              {" ← "}
              <Link href={`/admin/users/${entry.targetId}`} prefetch={false}>
                <bdi dir="ltr">@{entry.targetUsername}</bdi>
              </Link>
            </>
          )}
        </span>
        <time className="app-row-meta admin-card-time" dateTime={new Date(entry.createdAt).toISOString()}>
          {formatRelativeTime(entry.createdAt)}
        </time>
      </div>
      {text && (
        <p className="admin-card-text" dir="auto">
          {text}
        </p>
      )}
      {entry.reason && (
        <p className="app-row-meta" dir="auto">
          دلیل: {entry.reason}
        </p>
      )}
    </div>
  );
}
