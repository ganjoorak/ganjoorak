"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AdminConfirmDialog, { type AdminAction } from "@/components/admin/AdminConfirmDialog";
import AdminPage from "@/components/admin/AdminPage";
import { Chip, ListFooter, RoleChip, SearchField, Segmented } from "@/components/admin/AdminParts";
import { useAdmin } from "@/components/admin/AdminShell";
import { useAdminList } from "@/components/admin/useAdminList";
import ProfileAvatar from "@/components/ProfileAvatar";
import { bannerBackground, formatRelativeTime } from "@/components/profile/profileFormat";
import { Button } from "@/components/ui/button";
import { publicProfilePath, type StaffRole } from "@/utils/accountApi";
import {
  clearProfileField,
  fetchAdminMoves,
  fetchAdminProfiles,
  fetchAdminQuotes,
  removeMove,
  removeQuote,
  type AdminProfile,
  type ClearableField,
} from "@/utils/adminApi";
import { mediaUrl } from "@/utils/mediaApi";

export type ContentTab = "quotes" | "moves" | "profiles";

const TABS: readonly { value: ContentTab; label: string }[] = [
  { value: "profiles", label: "نمایه‌ها" },
  { value: "quotes", label: "تکه‌ها" },
  { value: "moves", label: "بیت‌ها" },
];

const MOVE_FILTERS = [
  { value: "all", label: "همه" },
  { value: "typed", label: "فقط تایپی" },
] as const;

const PROFILE_FILTERS = [
  { value: "all", label: "همه" },
  { value: "image", label: "با تصویر" },
  { value: "text", label: "با متن" },
] as const;

type Ask = (action: AdminAction) => void;

function Owner({ username, displayName, role }: { username: string; displayName: string; role: StaffRole }) {
  return (
    <span className="app-row-meta">
      <Link href={publicProfilePath(username)} prefetch={false}>
        <bdi>{displayName}</bdi>
      </Link>{" "}
      <bdi dir="ltr">@{username}</bdi> <RoleChip role={role} />
    </span>
  );
}

function RemoveButton({ disabled, onClick, children }: { disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button
      type="button"
      variant="destructive"
      size="lg"
      disabled={disabled}
      title={disabled ? "محتوای مدیر را فقط مدیر تغییر می‌دهد." : undefined}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function QuotesList({ ask, q }: { ask: Ask; q: string }) {
  const { role } = useAdmin();
  const list = useAdminList(q, (before) => fetchAdminQuotes({ q, before }));
  return (
    <>
      {list.items.length > 0 && (
        <ul className="admin-cards">
          {list.items.map((quote) => (
            <li key={quote.id} className="admin-card">
              <div className="admin-card-head">
                <Owner username={quote.username} displayName={quote.displayName} role={quote.role} />
                <time className="app-row-meta admin-card-time">{formatRelativeTime(quote.createdAt)}</time>
              </div>
              <p className="admin-card-text">{quote.lines.join(" / ")}</p>
              <div className="admin-card-foot">
                <Link href={quote.href} prefetch={false} className="app-row-meta admin-link">
                  {quote.poetName}، {quote.poemTitle}
                </Link>
                <RemoveButton
                  disabled={quote.role === "admin" && role !== "admin"}
                  onClick={() =>
                    ask({
                      title: "حذف این تکه",
                      description: "تکه از نمایه و داستان‌ها برداشته می‌شود و متنش در کارنامه می‌ماند.",
                      confirmLabel: "حذف",
                      doneMessage: "تکه حذف شد.",
                      destructive: true,
                      run: (reason) => removeQuote(quote.id, reason),
                      onDone: () => list.removeItem(quote.id),
                    })
                  }
                >
                  حذف
                </RemoveButton>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ListFooter
        isEmpty={list.items.length === 0}
        emptyText="تکه‌ای پیدا نشد."
        isLoading={list.isLoading}
        error={list.error}
        hasMore={list.next !== null}
        onMore={list.loadMore}
      />
    </>
  );
}

function MovesList({ ask, q }: { ask: Ask; q: string }) {
  const { role } = useAdmin();
  const [filter, setFilter] = useState<(typeof MOVE_FILTERS)[number]["value"]>("typed");
  const typed = filter === "typed";
  const list = useAdminList(`${filter}:${q}`, (before) => fetchAdminMoves({ q, typed: typed ? "1" : undefined, before }));
  return (
    <>
      <Segmented label="پالایش بیت‌ها" options={MOVE_FILTERS} value={filter} onChange={setFilter} />
      {list.items.length > 0 && (
        <ul className="admin-cards">
          {list.items.map((move) => (
            <li key={move.id} className="admin-card">
              <div className="admin-card-head">
                <Owner username={move.username} displayName={move.displayName} role={move.role} />
                {move.typed && <Chip>تایپی</Chip>}
                <time className="app-row-meta admin-card-time">{formatRelativeTime(move.createdAt)}</time>
              </div>
              <p className="admin-card-text">{move.lines.join(" / ")}</p>
              <div className="admin-card-foot">
                {!move.typed && (
                  <span className="app-row-meta">
                    {move.poetName}، {move.poemTitle}
                  </span>
                )}
                <RemoveButton
                  disabled={move.role === "admin" && role !== "admin"}
                  onClick={() =>
                    ask({
                      title: "حذف این بیت",
                      description: "در اتاق عمومی جای آن «این بیت حذف شد.» می‌آید تا زنجیره نشکند.",
                      confirmLabel: "حذف",
                      doneMessage: "بیت حذف شد.",
                      destructive: true,
                      run: (reason) => removeMove(move.id, reason),
                      onDone: () => list.removeItem(move.id),
                    })
                  }
                >
                  حذف
                </RemoveButton>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ListFooter
        isEmpty={list.items.length === 0}
        emptyText="بیتی پیدا نشد."
        isLoading={list.isLoading}
        error={list.error}
        hasMore={list.next !== null}
        onMore={list.loadMore}
      />
    </>
  );
}

const clearChoices = (profile: AdminProfile) => {
  const choices: { field: ClearableField; label: string }[] = [];
  if (mediaUrl(profile.avatar)) choices.push({ field: "avatar", label: "حذف تصویر" });
  if (mediaUrl(profile.banner)) choices.push({ field: "banner", label: "حذف بنر" });
  if (profile.bio) choices.push({ field: "bio", label: "پاک کردن معرفی" });
  if (profile.displayName !== profile.username) choices.push({ field: "displayName", label: "بازنشانی نام" });
  return choices;
};

function ProfilesList({ ask, q }: { ask: Ask; q: string }) {
  const { role } = useAdmin();
  const [has, setHas] = useState<(typeof PROFILE_FILTERS)[number]["value"]>("image");
  const list = useAdminList(`${has}:${q}`, (before) =>
    fetchAdminProfiles({ q, has: has === "all" ? undefined : has, before }),
  );
  return (
    <>
      <Segmented label="پالایش نمایه‌ها" options={PROFILE_FILTERS} value={has} onChange={setHas} />
      {list.items.length > 0 && (
        <ul className="admin-cards">
          {list.items.map((profile) => {
            const banner = mediaUrl(profile.banner) ? bannerBackground(profile.banner) : undefined;
            const choices = clearChoices(profile);
            return (
              <li key={profile.id} className="admin-card">
                {banner && <div className="admin-banner" style={banner} role="img" aria-label="بنر" />}
                <div className="admin-user">
                  <ProfileAvatar username={profile.username} avatar={profile.avatar} className="app-avatar" decorative />
                  <Owner username={profile.username} displayName={profile.displayName} role={profile.role} />
                </div>
                {profile.bio && (
                  <p className="admin-card-text" dir="auto">
                    {profile.bio}
                  </p>
                )}
                {choices.length > 0 && (
                  <div className="app-actions">
                    {choices.map((choice) => (
                      <RemoveButton
                        key={choice.field}
                        disabled={profile.role === "admin" && role !== "admin"}
                        onClick={() =>
                          ask({
                            title: `${choice.label}: @${profile.username}`,
                            confirmLabel: choice.label,
                            doneMessage: "انجام شد.",
                            destructive: true,
                            run: (reason) => clearProfileField(profile.id, choice.field, reason),
                            onDone: list.reload,
                          })
                        }
                      >
                        {choice.label}
                      </RemoveButton>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <ListFooter
        isEmpty={list.items.length === 0}
        emptyText="نمایه‌ای پیدا نشد."
        isLoading={list.isLoading}
        error={list.error}
        hasMore={list.next !== null}
        onMore={list.loadMore}
      />
    </>
  );
}

export default function AdminContentPage({ initialTab }: { initialTab: ContentTab }) {
  const router = useRouter();
  const [tab, setTab] = useState(initialTab);
  const [q, setQ] = useState("");
  const [action, setAction] = useState<AdminAction | null>(null);

  const changeTab = (next: ContentTab) => {
    setTab(next);
    router.replace(`/admin/content?tab=${next}`, { scroll: false });
  };

  return (
    <AdminPage title="محتوا" subtitle="هر حذف با متن اصلی در کارنامه ثبت می‌شود.">
      <div className="admin-toolbar">
        <Segmented label="نوع محتوا" options={TABS} value={tab} onChange={changeTab} />
        <SearchField label="جست‌وجو" onSearch={setQ} />
        {tab === "quotes" && <QuotesList ask={setAction} q={q} />}
        {tab === "moves" && <MovesList ask={setAction} q={q} />}
        {tab === "profiles" && <ProfilesList ask={setAction} q={q} />}
      </div>
      <AdminConfirmDialog action={action} onClose={() => setAction(null)} />
    </AdminPage>
  );
}
