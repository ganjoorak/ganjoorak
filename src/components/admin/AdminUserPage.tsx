"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AuditRow from "@/components/admin/AdminAudit";
import AdminConfirmDialog, { type AdminAction } from "@/components/admin/AdminConfirmDialog";
import AdminPage from "@/components/admin/AdminPage";
import { Chip, RoleChip, ROLE_LABELS, Segmented, formatNumber } from "@/components/admin/AdminParts";
import ProfileAvatar from "@/components/ProfileAvatar";
import { formatDate, formatRelativeTime } from "@/components/profile/profileFormat";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { Spinner } from "@/components/ui/spinner";
import { useAccountSession } from "@/hooks/useAccountSession";
import { publicProfilePath, type StaffRole } from "@/utils/accountApi";
import {
  banUser,
  fetchAdminUser,
  revokeUserSessions,
  setUserRole,
  unbanUser,
  type AdminUserDetail,
} from "@/utils/adminApi";

const ROLE_OPTIONS = (["", "moderator", "admin"] as const).map((value) => ({ value, label: ROLE_LABELS[value] }));

export default function AdminUserPage({ id }: { id: number }) {
  const { user: viewer } = useAccountSession();
  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState("");
  const [action, setAction] = useState<AdminAction | null>(null);

  const load = useCallback(() => {
    fetchAdminUser(id)
      .then(setUser)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : ""));
  }, [id]);

  useEffect(load, [load]);

  if (!user) {
    return (
      <AdminPage title="کاربر" adminOnly>
        {error ? (
          <FormError>{error}</FormError>
        ) : (
          <div className="admin-gate admin-gate--inline">
            <Spinner />
          </div>
        )}
      </AdminPage>
    );
  }

  const isSelf = viewer?.username === user.username;
  const isBanned = user.bannedAt > 0;
  const counts: [string, number][] = [
    ["نشست فعال", user.sessions],
    ["شعر خوانده", user.reads],
    ["تکه", user.quotes],
    ["بیت", user.moves],
    ["دنبال‌کننده", user.followers],
    ["دنبال‌شده", user.following],
  ];

  const askRole = (role: StaffRole) => {
    if (role === user.role) return;
    setAction({
      title: `نقش @${user.username}: ${ROLE_LABELS[role]}`,
      description: role === "admin" ? "مدیر به همهٔ بخش‌ها و تعیین نقش دسترسی دارد." : undefined,
      confirmLabel: "تغییر نقش",
      doneMessage: "نقش تغییر کرد.",
      run: (reason) => setUserRole(id, role, reason),
      onDone: load,
    });
  };

  return (
    <AdminPage title={user.displayName} adminOnly>
      <section className="admin-card admin-user">
        <ProfileAvatar username={user.username} avatar={user.avatar} className="app-avatar" decorative />
        <div className="app-row-body">
          <span className="app-row-title admin-row-title">
            <bdi>{user.displayName}</bdi>
            <RoleChip role={user.role} />
            {isBanned && <Chip tone="danger">مسدود</Chip>}
            {!user.isPublic && <Chip>خصوصی</Chip>}
          </span>
          <span className="app-row-meta">
            <bdi dir="ltr">@{user.username}</bdi> · عضویت {formatDate(user.createdAt)}
            {user.readingAt > 0 && <> · آخرین خواندن {formatRelativeTime(user.readingAt)}</>}
            {!user.hasRecoveryCode && " · بدون کد بازیابی"}
          </span>
          {user.isPublic && !isBanned && (
            <Link href={publicProfilePath(user.username)} prefetch={false} className="app-row-meta admin-link">
              دیدن نمایه
            </Link>
          )}
        </div>
      </section>

      {user.bio && (
        <p className="admin-card admin-card-text" dir="auto">
          {user.bio}
        </p>
      )}

      <section className="app-section" aria-label="آمار کاربر">
        <div className="admin-stats admin-stats--small">
          {counts.map(([label, value]) => (
            <div key={label} className="admin-stat">
              <span className="admin-stat-label">{label}</span>
              <strong className="admin-stat-value">{formatNumber(value)}</strong>
            </div>
          ))}
        </div>
      </section>

      {!isSelf && (
        <section className="app-section">
          <h2 className="app-section-title">اقدام‌ها</h2>
          <div className="admin-card admin-actions">
            {!isBanned && (
              <Segmented label="نقش" options={ROLE_OPTIONS} value={user.role} onChange={askRole} />
            )}
            <div className="app-actions">
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() =>
                  setAction({
                    title: `خروج @${user.username} از همهٔ نشست‌ها`,
                    description: "برای حساب دزدیده‌شده: کاربر باید دوباره وارد شود.",
                    confirmLabel: "خروج از نشست‌ها",
                    doneMessage: "نشست‌ها بسته شد.",
                    run: (reason) => revokeUserSessions(id, reason),
                    onDone: load,
                  })
                }
              >
                خروج از همهٔ نشست‌ها
              </Button>
              {isBanned ? (
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  onClick={() =>
                    setAction({
                      title: `رفع مسدودی @${user.username}`,
                      confirmLabel: "رفع مسدودی",
                      doneMessage: "مسدودی برداشته شد.",
                      run: (reason) => unbanUser(id, reason),
                      onDone: load,
                    })
                  }
                >
                  رفع مسدودی
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="destructive"
                  size="lg"
                  disabled={user.role !== ""}
                  title={user.role !== "" ? "ابتدا نقش این کاربر را بردارید." : undefined}
                  onClick={() =>
                    setAction({
                      title: `مسدودسازی @${user.username}`,
                      description: "حساب از همه‌جا پنهان می‌شود و کاربر نمی‌تواند وارد شود.",
                      confirmLabel: "مسدود کن",
                      doneMessage: "حساب مسدود شد.",
                      destructive: true,
                      reasonRequired: true,
                      run: (reason) => banUser(id, reason),
                      onDone: load,
                    })
                  }
                >
                  مسدودسازی
                </Button>
              )}
            </div>
          </div>
        </section>
      )}

      {user.audit.length > 0 && (
        <section className="app-section">
          <h2 className="app-section-title">سابقه</h2>
          <ul className="admin-cards">
            {user.audit.map((entry) => (
              <li key={entry.id}>
                <AuditRow entry={entry} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <AdminConfirmDialog action={action} onClose={() => setAction(null)} />
    </AdminPage>
  );
}
