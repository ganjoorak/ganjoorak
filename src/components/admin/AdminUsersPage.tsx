"use client";

import { useState } from "react";
import Link from "next/link";
import { FaChevronLeft } from "react-icons/fa";
import AdminPage from "@/components/admin/AdminPage";
import { Chip, ListFooter, RoleChip, SearchField, Segmented } from "@/components/admin/AdminParts";
import { useAdminList } from "@/components/admin/useAdminList";
import ProfileAvatar from "@/components/ProfileAvatar";
import { formatDate } from "@/components/profile/profileFormat";
import { fetchAdminUsers } from "@/utils/adminApi";

const FILTERS = [
  { value: "all", label: "همه" },
  { value: "banned", label: "مسدود" },
  { value: "staff", label: "کارکنان" },
] as const;

type Filter = (typeof FILTERS)[number]["value"];

export default function AdminUsersPage() {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const list = useAdminList(`${filter}:${q}`, (before) => fetchAdminUsers({ q, filter, before }));

  return (
    <AdminPage title="کاربران" adminOnly>
      <div className="admin-toolbar">
        <SearchField label="جست‌وجوی نام یا نام کاربری" onSearch={setQ} />
        <Segmented label="پالایش کاربران" options={FILTERS} value={filter} onChange={setFilter} />
      </div>
      {list.items.length > 0 && (
        <ul className="app-list">
          {list.items.map((user) => (
            <li key={user.id}>
              <Link href={`/admin/users/${user.id}`} prefetch={false} className="app-row">
                <ProfileAvatar username={user.username} avatar={user.avatar} className="app-avatar" decorative />
                <span className="app-row-body">
                  <span className="app-row-title admin-row-title">
                    <bdi>{user.displayName}</bdi>
                    <RoleChip role={user.role} />
                    {user.bannedAt > 0 && <Chip tone="danger">مسدود</Chip>}
                    {!user.isPublic && <Chip>خصوصی</Chip>}
                  </span>
                  <span className="app-row-meta">
                    <bdi dir="ltr">@{user.username}</bdi> · {formatDate(user.createdAt)}
                  </span>
                </span>
                <FaChevronLeft className="app-row-chevron" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <ListFooter
        isEmpty={list.items.length === 0}
        emptyText="کاربری پیدا نشد."
        isLoading={list.isLoading}
        error={list.error}
        hasMore={list.next !== null}
        onMore={list.loadMore}
      />
    </AdminPage>
  );
}
