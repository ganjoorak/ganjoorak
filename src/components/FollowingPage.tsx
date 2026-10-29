"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FaChevronLeft, FaRegStar, FaUsers } from "react-icons/fa";
import AppPage from "@/components/AppPage";
import ProfileAvatar from "@/components/ProfileAvatar";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyIcon } from "@/components/ui/empty";
import { FormError } from "@/components/ui/form-error";
import { Tabs, TabsIndicator, TabsList, TabsTab } from "@/components/ui/tabs";
import {
  AccountError,
  fetchFollowList,
  publicProfilePath,
  unfollowUser,
  type FollowedUser,
} from "@/utils/accountApi";
import "../styles/PoemLibrary.css";

type FollowTab = "following" | "followers";

const persianNumber = new Intl.NumberFormat("fa-IR");

const EMPTY_TEXT: Record<FollowTab, string> = {
  following:
    "هنوز کسی را دنبال نمی‌کنید. در نمایهٔ هر کس «دنبال کردن» را بزنید تا اینجا جمع شوند.",
  followers: "هنوز کسی شما را دنبال نمی‌کند. پیوند نمایهٔ خود را با دوستانتان به اشتراک بگذارید.",
};

/**
 * The people the reader follows and the people following them. Poets live on
 * /preferred-poets: they cannot be followed, only preferred.
 */
const FollowingPage = ({ initialTab }: { initialTab: FollowTab }) => {
  const router = useRouter();
  const [tab, setTab] = useState<FollowTab>(initialTab);
  // Each list loads once; null means "not loaded yet".
  const [lists, setLists] = useState<Record<FollowTab, FollowedUser[] | null>>({
    following: null,
    followers: null,
  });
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(
    (kind: FollowTab) => {
      fetchFollowList(kind)
        .then((users) => setLists((current) => ({ ...current, [kind]: users })))
        .catch((caught) => {
          if (caught instanceof AccountError && caught.status === 401) {
            router.replace("/login");
          } else {
            setError(caught instanceof AccountError ? caught.message : "خطایی رخ داد.");
          }
        });
    },
    [router],
  );

  useEffect(() => {
    load("following");
    load("followers");
  }, [load]);

  const handleUnfollow = async (username: string) => {
    setError("");
    setRemoving(username);
    try {
      await unfollowUser(username);
      setLists((current) => ({
        ...current,
        following: current.following?.filter((user) => user.username !== username) ?? null,
      }));
    } catch (caught) {
      setError(caught instanceof AccountError ? caught.message : "خطایی رخ داد.");
    } finally {
      setRemoving(null);
    }
  };

  const users = lists[tab];
  const tabs: { id: FollowTab; label: string }[] = [
    { id: "following", label: "دنبال‌شده‌ها" },
    { id: "followers", label: "دنبال‌کننده‌ها" },
  ];

  return (
    <AppPage
      title="دنبال‌شده‌ها"
      backHref="/profile"
      width="narrow"
      subtitle="کسانی که دنبال می‌کنید و کسانی که شما را دنبال می‌کنند. فقط نمایه‌های عمومی دیده می‌شوند."
      headerExtra={
        <Tabs value={tab} onValueChange={(value) => setTab(value as FollowTab)}>
          <TabsList className="relative" aria-label="دنبال‌شده‌ها و دنبال‌کننده‌ها">
            <TabsIndicator />
            {tabs.map((item) => (
              <TabsTab
                key={item.id}
                value={item.id}
                className="relative data-active:bg-transparent data-active:shadow-none"
              >
                {item.label}
                {lists[item.id] !== null && lists[item.id]!.length > 0 && (
                  <span className="follow-tab-count">{persianNumber.format(lists[item.id]!.length)}</span>
                )}
              </TabsTab>
            ))}
          </TabsList>
        </Tabs>
      }
    >
      {error && <FormError>{error}</FormError>}

      {users === null ? (
        !error && (
          <Empty role="status">
            <EmptyDescription>در حال بارگذاری…</EmptyDescription>
          </Empty>
        )
      ) : users.length > 0 ? (
        <ul className="app-list">
          {users.map((user) => (
            <li key={user.username} className="follow-item">
              <Link href={publicProfilePath(user.username)} className="app-row follow-link" prefetch={false}>
                <ProfileAvatar username={user.username} avatar={user.avatar} className="follow-avatar" decorative />
                <span className="app-row-body">
                  <span className="app-row-title">{user.displayName}</span>
                  <span className="app-row-meta" dir="ltr">
                    @{user.username}
                  </span>
                </span>
                <FaChevronLeft className="app-row-chevron" aria-hidden="true" />
              </Link>
              {tab === "following" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="follow-remove"
                  disabled={removing === user.username}
                  onClick={() => handleUnfollow(user.username)}
                  aria-label={`لغو دنبال کردن ${user.displayName}`}
                >
                  لغو دنبال
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <Empty>
          <EmptyIcon>
            <FaUsers />
          </EmptyIcon>
          <EmptyDescription>{EMPTY_TEXT[tab]}</EmptyDescription>
        </Empty>
      )}

      <section className="app-section">
        <h2 className="app-section-title">بیشتر</h2>
        <ul className="app-list">
          <li>
            <Link href="/preferred-poets" className="app-row">
              <span className="app-row-icon" aria-hidden="true">
                <FaRegStar />
              </span>
              <span className="app-row-body">
                <span className="app-row-title">شاعران مورد علاقه</span>
                <span className="app-row-meta">شاعرانی که فید «علاقه‌مندی‌ها» از آن‌ها شعر می‌آورد</span>
              </span>
              <FaChevronLeft className="app-row-chevron" aria-hidden="true" />
            </Link>
          </li>
        </ul>
      </section>
    </AppPage>
  );
};

export default FollowingPage;
