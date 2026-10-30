"use client";

import { useEffect, useState } from "react";
import AdminPage from "@/components/admin/AdminPage";
import AdminTrendChart from "@/components/admin/AdminTrendChart";
import { formatNumber } from "@/components/admin/AdminParts";
import { useAdmin } from "@/components/admin/AdminShell";
import { Spinner } from "@/components/ui/spinner";
import { FormError } from "@/components/ui/form-error";
import { fetchAdminOverview, type AdminOverview } from "@/utils/adminApi";

function Stat({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="admin-stat">
      <span className="admin-stat-label">{label}</span>
      <strong className="admin-stat-value">{formatNumber(value)}</strong>
      {note && <span className="admin-stat-note">{note}</span>}
    </div>
  );
}

function OverviewBody() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchAdminOverview()
      .then(setOverview)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : ""));
  }, []);

  if (error) return <FormError>{error}</FormError>;
  if (!overview) {
    return (
      <div className="admin-gate admin-gate--inline">
        <Spinner />
      </div>
    );
  }
  return (
    <>
      <section className="app-section" aria-label="آمار کلی">
        <div className="admin-stats">
          <Stat
            label="کاربران"
            value={overview.users}
            note={`${formatNumber(overview.bannedUsers)} مسدود، ${formatNumber(overview.staff)} کارکن`}
          />
          <Stat
            label="کاربران فعال امروز"
            value={overview.active.day}
            note={`${formatNumber(overview.active.week)} در هفته، ${formatNumber(overview.active.month)} در ماه`}
          />
          <Stat
            label="ثبت‌نام این هفته"
            value={overview.signups.week}
            note={`${formatNumber(overview.signups.day)} امروز، ${formatNumber(overview.signups.month)} در ماه`}
          />
          <Stat label="تکه‌ها" value={overview.quotes} note={`${formatNumber(overview.newQuotes.week)} در این هفته`} />
          <Stat label="بیت‌های اتاق عمومی" value={overview.moves} note={`${formatNumber(overview.newMoves.week)} در این هفته`} />
          <Stat
            label="مسابقه‌ها"
            value={overview.matches}
            note={`${formatNumber(overview.activeMatches)} در جریان`}
          />
          <Stat label="بازخورد بررسی‌نشده" value={overview.openFeedback} />
        </div>
      </section>
      <section className="app-section">
        <h2 className="app-section-title">روند ۳۰ روز گذشته</h2>
        <AdminTrendChart trend={overview.trend} />
      </section>
    </>
  );
}

export default function AdminOverviewPage() {
  const { role } = useAdmin();
  return (
    <AdminPage title="داشبورد مدیریت" subtitle="«فعال» یعنی کسی که آن روز شعری خوانده است." adminOnly>
      {role === "admin" && <OverviewBody />}
    </AdminPage>
  );
}
