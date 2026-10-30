"use client";

import { useState } from "react";
import AuditRow, { AUDIT_ACTIONS } from "@/components/admin/AdminAudit";
import AdminPage from "@/components/admin/AdminPage";
import { ListFooter } from "@/components/admin/AdminParts";
import { useAdminList } from "@/components/admin/useAdminList";
import { fetchAdminAudit } from "@/utils/adminApi";

export default function AdminAuditPage() {
  const [action, setAction] = useState("");
  const list = useAdminList(action, (before) => fetchAdminAudit({ action, before }));

  return (
    <AdminPage title="کارنامه" subtitle="همهٔ کارهای مدیران و ناظران، با متن چیزی که حذف شده است." adminOnly>
      <div className="admin-pills" role="group" aria-label="نوع کار">
        {[["", "همه"], ...Object.entries(AUDIT_ACTIONS)].map(([value, label]) => (
          <button key={value} type="button" aria-pressed={value === action} onClick={() => setAction(value)}>
            {label}
          </button>
        ))}
      </div>
      {list.items.length > 0 && (
        <ul className="admin-cards">
          {list.items.map((entry) => (
            <li key={entry.id}>
              <AuditRow entry={entry} />
            </li>
          ))}
        </ul>
      )}
      <ListFooter
        isEmpty={list.items.length === 0}
        emptyText="هنوز کاری ثبت نشده است."
        isLoading={list.isLoading}
        error={list.error}
        hasMore={list.next !== null}
        onMore={list.loadMore}
      />
    </AdminPage>
  );
}
