"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { FaBook, FaBookmark, FaChevronLeft, FaHeart, FaHistory, FaRegBookmark, FaRegHeart, FaTimes } from "react-icons/fa";
import AppPage from "@/components/AppPage";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  LIBRARY_CHANGE_EVENT,
  clearHistory,
  readFavorites,
  readHistory,
  removeFavorite,
  type PoemLibraryEntry,
} from "@/utils/poemLibrary";
import { readLovedCollections, removeLovedCollection, type CollectionEntry } from "@/utils/collectionLibrary";
import "../styles/PoemLibrary.css";
import { Empty, EmptyDescription, EmptyIcon } from "@/components/ui/empty";
import { Tabs, TabsIndicator, TabsList, TabsTab } from "@/components/ui/tabs";

type LibraryTab = "favorites" | "books" | "history";

const persianNumber = new Intl.NumberFormat("fa-IR");
const persianDateFormatter = new Intl.DateTimeFormat("fa-IR", {
  dateStyle: "medium",
  timeStyle: "short",
});

const formatSavedAt = (timestamp: number) =>
  persianDateFormatter.format(new Date(timestamp));

/** Grouped card list of poems (saved page and profile). */
export const PoemLibraryList = ({
  entries,
  emptyMessage,
  emptyAction,
  icon = "bookmark",
  onRemove,
}: {
  entries: PoemLibraryEntry[];
  emptyMessage: string;
  emptyAction?: ReactNode;
  icon?: "bookmark" | "heart" | "history";
  onRemove?: (key: string) => void;
}) => {
  const leavingRef = useRef(new Set<string>());

  // Fade the row out and close its gap before it is removed, so the list doesn't jump.
  const handleRemove = (event: MouseEvent<HTMLButtonElement>, key: string) => {
    if (!onRemove || leavingRef.current.has(key)) return;
    const item = event.currentTarget.closest("li");
    if (!item || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onRemove(key);
      return;
    }
    leavingRef.current.add(key);
    item.style.overflow = "hidden";
    item
      .animate(
        [
          { height: `${item.offsetHeight}px`, opacity: 1 },
          { height: "0px", opacity: 0 },
        ],
        { duration: 260, easing: "cubic-bezier(0.32, 0.72, 0, 1)", fill: "forwards" },
      )
      .finished.catch(() => undefined)
      .then(() => {
        leavingRef.current.delete(key);
        onRemove(key);
      });
  };

  if (entries.length === 0) {
    return (
      <Empty>
        <EmptyIcon>{icon === "history" ? <FaHistory /> : icon === "heart" ? <FaRegHeart /> : <FaRegBookmark />}</EmptyIcon>
        <EmptyDescription>{emptyMessage}</EmptyDescription>
        {emptyAction}
      </Empty>
    );
  }

  return (
    <ul className="app-list library-list">
      {entries.map((entry) => (
        <li key={entry.key} className="library-item">
          <Link href={entry.href} className="app-row library-link" prefetch={false}>
            <span className="app-row-icon" aria-hidden="true">
              {icon === "history" ? <FaHistory /> : icon === "heart" ? <FaHeart /> : <FaBookmark />}
            </span>
            <span className="app-row-body">
              <span className="app-row-title library-title">{entry.title}</span>
              {entry.excerpt && <span className="library-excerpt">{entry.excerpt}</span>}
              <span className="app-row-meta">
                {entry.poetName}
                {" · "}
                {/* Server-rendered profiles format in the server's time zone. */}
                <time dateTime={new Date(entry.savedAt).toISOString()} suppressHydrationWarning>
                  {formatSavedAt(entry.savedAt)}
                </time>
              </span>
            </span>
            {!onRemove && <FaChevronLeft className="app-row-chevron" aria-hidden="true" />}
          </Link>
          {onRemove && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="library-remove"
              onClick={(event) => handleRemove(event, entry.key)}
              aria-label={`حذف «${entry.title}» از ذخیره‌ها`}
            >
              <FaTimes aria-hidden="true" />
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
};

/** Loved books (saved page and profile): each opens its poet's page. */
export const CollectionList = ({
  entries,
  emptyMessage,
  emptyAction,
  onRemove,
}: {
  entries: CollectionEntry[];
  emptyMessage: string;
  emptyAction?: ReactNode;
  onRemove?: (key: string) => void;
}) => {
  if (entries.length === 0) {
    return (
      <Empty>
        <EmptyIcon>
          <FaBook />
        </EmptyIcon>
        <EmptyDescription>{emptyMessage}</EmptyDescription>
        {emptyAction}
      </Empty>
    );
  }
  return (
    <ul className="app-list library-list">
      {entries.map((entry) => (
        <li key={entry.key} className="library-item">
          <Link href={entry.href} className="app-row library-link" prefetch={false}>
            <span className="app-row-icon" aria-hidden="true">
              <FaBook />
            </span>
            <span className="app-row-body">
              <span className="app-row-title library-title">{entry.title}</span>
              <span className="app-row-meta">{entry.poetName}</span>
            </span>
            {!onRemove && <FaChevronLeft className="app-row-chevron" aria-hidden="true" />}
          </Link>
          {onRemove && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="library-remove"
              onClick={() => onRemove(entry.key)}
              aria-label={`برداشتن «${entry.title}» از دوست‌داشته‌ها`}
            >
              <FaTimes aria-hidden="true" />
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
};

/** Re-reads localStorage-backed lists after mount and on library changes. */
export const useLibraryVersion = () => {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const refresh = () => setVersion((value) => value + 1);
    refresh();
    window.addEventListener(LIBRARY_CHANGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(LIBRARY_CHANGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return version;
};

const PoemLibraryPage = () => {
  const [activeTab, setActiveTab] = useState<LibraryTab>("favorites");
  const [refreshKey, setRefreshKey] = useState(0);
  const version = useLibraryVersion();
  const isReady = version > 0;

  void refreshKey;
  const favorites = isReady ? readFavorites() : [];
  const history = isReady ? readHistory() : [];
  const books = isReady ? readLovedCollections() : [];
  const refresh = () => setRefreshKey((value) => value + 1);

  const tabs = [
    { id: "favorites" as const, label: "ذخیره‌شده‌ها", icon: <FaBookmark aria-hidden="true" />, count: favorites.length },
    { id: "books" as const, label: "کتاب‌ها", icon: <FaBook aria-hidden="true" />, count: books.length },
    { id: "history" as const, label: "اخیراً دیده‌شده", icon: <FaHistory aria-hidden="true" />, count: history.length },
  ];

  return (
    <AppPage
      title="نشان‌شده‌ها"
      subtitle="شعرهایی که ذخیره کرده‌اید، کتاب‌هایی که دوست دارید و آن‌هایی که اخیراً خوانده‌اید."
      width="narrow"
      headerExtra={
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)}>
          <TabsList aria-label="نشان‌شده‌ها" className="relative">
          <TabsIndicator />
          {tabs.map((tab) => (
            <TabsTab
              key={tab.id}
              value={tab.id}
              className="relative data-active:bg-transparent data-active:shadow-none"
            >
              {tab.icon}
              {tab.label}
              {isReady && tab.count > 0 && (
                <span className="library-tab-count">{persianNumber.format(tab.count)}</span>
              )}
            </TabsTab>
          ))}
          </TabsList>
        </Tabs>
      }
    >
      {!isReady ? (
        <p className="app-row-meta" role="status">در حال بارگذاری…</p>
      ) : (
        // Re-keyed per tab so switching fades the other list in.
        <div key={activeTab} className="library-panel">
          {activeTab === "favorites" ? (
            <PoemLibraryList
              entries={favorites}
              emptyMessage="هنوز شعری ذخیره نکرده‌اید. روی آیکن قلب در صفحهٔ شعر بزنید تا اینجا بماند."
              emptyAction={
                <Link href="/" className={buttonVariants({ variant: "secondary" })}>
                  رفتن به فید
                </Link>
              }
              onRemove={(key) => {
                removeFavorite(key);
                refresh();
              }}
            />
          ) : activeTab === "books" ? (
            <CollectionList
              entries={books}
              emptyMessage="هنوز کتابی را دوست نداشته‌اید. در صفحهٔ هر شاعر روی قلبِ کنار مجموعه بزنید؛ شعر آن کتاب‌ها به فید «علاقه‌مندی‌ها» هم می‌آید."
              emptyAction={
                <Link href="/poets" className={buttonVariants({ variant: "secondary" })}>
                  دیدن شاعران
                </Link>
              }
              onRemove={(key) => {
                removeLovedCollection(key);
                refresh();
              }}
            />
          ) : (
            <section className="app-section">
              {history.length > 0 && (
                <div className="app-section-title">
                  <span>{persianNumber.format(history.length)} شعر</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      clearHistory();
                      refresh();
                    }}
                  >
                    پاک کردن تاریخچه
                  </Button>
                </div>
              )}
              <PoemLibraryList
                entries={history}
                icon="history"
                emptyMessage="هنوز شعری نخوانده‌اید."
              />
            </section>
          )}
        </div>
      )}
    </AppPage>
  );
};

export default PoemLibraryPage;
