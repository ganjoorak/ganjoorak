"use client";

import { useState } from "react";
import Link from "next/link";
import AdminPage from "@/components/admin/AdminPage";
import { Chip, ListFooter, Segmented } from "@/components/admin/AdminParts";
import { useAdmin } from "@/components/admin/AdminShell";
import { useAdminList } from "@/components/admin/useAdminList";
import { formatRelativeTime } from "@/components/profile/profileFormat";
import { toast } from "@/components/toast/toastStore";
import { Button } from "@/components/ui/button";
import { publicProfilePath } from "@/utils/accountApi";
import { fetchAdminFeedback, setFeedbackReviewed, type AdminFeedback } from "@/utils/adminApi";

const STATUSES = [
  { value: "open", label: "بررسی‌نشده" },
  { value: "reviewed", label: "بررسی‌شده" },
  { value: "all", label: "همه" },
] as const;

const KINDS = [
  { value: "all", label: "همه" },
  { value: "suggestion", label: "پیشنهاد" },
  { value: "bug", label: "ایراد" },
  { value: "other", label: "دیگر" },
] as const;

const KIND_LABELS: Record<string, string> = { suggestion: "پیشنهاد", bug: "ایراد", other: "دیگر" };

type Status = (typeof STATUSES)[number]["value"];
type Kind = (typeof KINDS)[number]["value"];

/** The client sends page unchecked, so only a path of this site becomes a link. */
const isLocalPath = (page: string) => /^\/(?![/\\])/.test(page);

function FeedbackCard({ item, onToggle }: { item: AdminFeedback; onToggle: () => void }) {
  const [isSaving, setIsSaving] = useState(false);
  const reviewed = item.reviewedAt > 0;

  const toggle = async () => {
    setIsSaving(true);
    try {
      await setFeedbackReviewed(item.id, !reviewed);
      onToggle();
    } catch (reason) {
      toast({ title: reason instanceof Error ? reason.message : "", tone: "error" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="admin-card">
      <div className="admin-card-head">
        <Chip>{KIND_LABELS[item.kind] ?? item.kind}</Chip>
        <span className="app-row-meta">
          {item.username ? (
            <Link href={publicProfilePath(item.username)} prefetch={false}>
              <bdi dir="ltr">@{item.username}</bdi>
            </Link>
          ) : (
            "ناشناس"
          )}
        </span>
        <time className="app-row-meta admin-card-time" dateTime={new Date(item.createdAt).toISOString()}>
          {formatRelativeTime(item.createdAt)}
        </time>
      </div>
      <p className="admin-card-text" dir="auto">
        {item.message}
      </p>
      {item.contact && (
        <p className="app-row-meta">
          راه تماس: <bdi>{item.contact}</bdi>
        </p>
      )}
      {item.page && (
        <p className="app-row-meta">
          صفحه:{" "}
          {isLocalPath(item.page) ? (
            <Link href={item.page} prefetch={false} className="admin-link">
              <bdi dir="ltr">{item.page}</bdi>
            </Link>
          ) : (
            <bdi dir="ltr">{item.page}</bdi>
          )}
        </p>
      )}
      <div className="admin-card-foot">
        {reviewed && <span className="app-row-meta">بررسی‌شده توسط <bdi dir="ltr">{item.reviewedBy}</bdi></span>}
        <Button type="button" variant="outline" size="lg" disabled={isSaving} onClick={() => void toggle()}>
          {reviewed ? "بازگرداندن به صف" : "بررسی شد"}
        </Button>
      </div>
    </div>
  );
}

export default function AdminFeedbackPage() {
  const { refresh } = useAdmin();
  const [status, setStatus] = useState<Status>("open");
  const [kind, setKind] = useState<Kind>("all");
  const list = useAdminList(`${status}:${kind}`, (before) =>
    fetchAdminFeedback({ status, kind: kind === "all" ? undefined : kind, before }),
  );

  return (
    <AdminPage title="بازخوردها">
      <div className="admin-toolbar">
        <Segmented label="وضعیت" options={STATUSES} value={status} onChange={setStatus} />
        <Segmented label="نوع بازخورد" options={KINDS} value={kind} onChange={setKind} />
      </div>
      {list.items.length > 0 && (
        <ul className="admin-cards">
          {list.items.map((item) => (
            <li key={item.id}>
              <FeedbackCard
                item={item}
                onToggle={() => {
                  refresh();
                  if (status === "all") list.reload();
                  else list.removeItem(item.id);
                }}
              />
            </li>
          ))}
        </ul>
      )}
      <ListFooter
        isEmpty={list.items.length === 0}
        emptyText="بازخوردی در این صف نیست."
        isLoading={list.isLoading}
        error={list.error}
        hasMore={list.next !== null}
        onMore={list.loadMore}
      />
    </AdminPage>
  );
}
