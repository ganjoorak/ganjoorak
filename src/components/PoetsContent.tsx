"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode, type WheelEvent } from "react";
import { FaListUl, FaPlus, FaRegStar, FaSearch, FaStar, FaThLarge, FaTimes } from "react-icons/fa";
import { Century, Poet } from "@/types/poet";
import PoetImage from "@/components/PoetImage";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { buildPoetKey, usePreferredPoet } from "@/hooks/usePreferredPoet";
import { useSettings } from "@/context/SettingsContext";
import "@/styles/Poets.css";
import { Empty, EmptyDescription, EmptyIcon } from "@/components/ui/empty";
import { Tabs, TabsIndicator, TabsList, TabsTab } from "@/components/ui/tabs";

const persianNumber = new Intl.NumberFormat("fa-IR");
const OTHER_MODERN_GROUP = "دیگر شاعران";
const ALL_FILTER_ID = "all";
const FALLBACK_FEATURED_GANJOOR_SLUGS = [
  "hafez",
  "saadi",
  "moulavi",
  "ferdousi",
  "khayyam",
  "attar",
  "nezami",
  "sanaee",
];

type PoetsTab = "featured" | "classic" | "modern" | "preferred";
type PoetsView = "grid" | "list";

interface PoetEntry {
  key: string;
  poet: Poet;
  name: string;
  fullName: string | null;
  group: string;
  href: string;
  isExternal: boolean;
  poetKey: string | null;
  searchText: string;
}

interface PoetFilterOption {
  id: string;
  label: string;
}

const normalize = (value: string) =>
  value
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u064B-\u065F\u0670\u200c]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const toEntry = (poet: Poet, group: string): PoetEntry => {
  const isExternal = /^https?:\/\//.test(poet.fullUrl);
  const href = isExternal
    ? poet.fullUrl
    : poet.fullUrl.startsWith("/")
      ? poet.fullUrl
      : `/${poet.fullUrl}`;
  const slug = (poet.urlSlug || poet.fullUrl || "").replace(/^\/+|\/+$/g, "");
  const name = poet.nickname || poet.name;
  return {
    key: `${poet.source ?? "ganjoor"}-${slug || poet.name}-${poet.id}`,
    poet,
    name,
    fullName: poet.nickname && poet.nickname !== poet.name ? poet.name : null,
    group,
    href,
    isExternal,
    poetKey: !isExternal && slug ? buildPoetKey(poet.source ?? "ganjoor", slug) : null,
    searchText: normalize(`${poet.nickname ?? ""} ${poet.name} ${slug}`),
  };
};

const byName = (a: PoetEntry, b: PoetEntry) => a.name.localeCompare(b.name, "fa");

function PreferredToggle({ poetKey, name }: { poetKey: string; name: string }) {
  const { isPreferred, togglePreferred } = usePreferredPoet(poetKey);
  return (
    <Button
      type="button"
      size="sm"
      variant={isPreferred ? "secondary" : "outline"}
      className="poets-prefer"
      aria-pressed={isPreferred}
      aria-label={isPreferred ? `حذف ${name} از علاقه‌مندی‌ها` : `افزودن ${name} به علاقه‌مندی‌ها`}
      onClick={togglePreferred}
    >
      {isPreferred ? <FaStar aria-hidden="true" /> : <FaRegStar aria-hidden="true" />}
      {isPreferred ? "مورد علاقه" : "علاقه‌مندم"}
    </Button>
  );
}

function PoetLink({
  entry,
  className,
  children,
}: {
  entry: PoetEntry;
  className: string;
  children: ReactNode;
}) {
  if (entry.isExternal) {
    return (
      <a href={entry.href} className={className} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  return (
    <Link href={entry.href} className={className}>
      {children}
    </Link>
  );
}

function PoetCollection({ entries, view }: { entries: PoetEntry[]; view: PoetsView }) {
  if (view === "list") {
    return (
      <ul className="app-list poets-list">
        {entries.map((entry) => (
          <li key={entry.key} className="poets-list-item">
            <PoetLink entry={entry} className="app-row poets-list-link">
              <span className="app-avatar poets-avatar" aria-hidden="true">
                <PoetImage
                  imgUrl={entry.poet.imageUrl}
                  alt=""
                  poetSlug={entry.poet.urlSlug}
                  width={48}
                  height={48}
                />
              </span>
              <span className="app-row-body">
                <span className="app-row-title">{entry.name}</span>
                <span className="app-row-meta">
                  {[entry.fullName, entry.group].filter(Boolean).join(" · ")}
                </span>
              </span>
            </PoetLink>
            {entry.poetKey && <PreferredToggle poetKey={entry.poetKey} name={entry.name} />}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className="poets-grid">
      {entries.map((entry) => (
        <li key={entry.key} data-slot="card" className="poets-tile rounded-xl bg-card text-card-foreground ring-1 ring-foreground/10">
          <PoetLink entry={entry} className="poets-tile-link">
            <span className="poets-tile-avatar" aria-hidden="true">
              <PoetImage
                imgUrl={entry.poet.imageUrl}
                alt=""
                poetSlug={entry.poet.urlSlug}
                width={88}
                height={88}
              />
            </span>
            <span className="poets-tile-name">{entry.name}</span>
            <span className="poets-tile-meta">{entry.fullName ?? entry.group}</span>
          </PoetLink>
          {entry.poetKey && <PreferredToggle poetKey={entry.poetKey} name={entry.name} />}
        </li>
      ))}
    </ul>
  );
}

export default function PoetsContent({
  centuries,
  customPoets = [],
  modernPoets = [],
}: {
  centuries: Century[];
  customPoets?: Poet[];
  modernPoets?: Poet[];
}) {
  const { settings } = useSettings();
  const [tab, setTab] = useState<PoetsTab>("featured");
  const [view, setView] = useState<PoetsView>("grid");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(ALL_FILTER_ID);

  const { featured, classic, modern, classicFilters, modernFilters } = useMemo(() => {
    const apiFeatured = centuries.find((c) => c.id === 0);
    const otherCenturies = centuries.filter((c) => c.id !== 0);
    const seen = new Set<string>();
    const classicEntries: PoetEntry[] = [];
    otherCenturies.forEach((century) => {
      century.poets
        .filter((poet) => poet.published)
        .forEach((poet) => {
          const entry = toEntry(poet, century.name);
          if (seen.has(entry.key)) return;
          seen.add(entry.key);
          classicEntries.push(entry);
        });
    });

    const pinned = otherCenturies
      .flatMap((century) => century.poets)
      .filter((poet) => poet.published && poet.pinOrder > 0)
      .sort((a, b) => a.pinOrder - b.pinOrder);
    const featuredPoets = apiFeatured?.poets.filter((poet) => poet.published).length
      ? apiFeatured.poets.filter((poet) => poet.published)
      : pinned.length > 0
        ? pinned
        : FALLBACK_FEATURED_GANJOOR_SLUGS.map((slug) =>
          otherCenturies
            .flatMap((century) => century.poets)
            .find((poet) => poet.published && poet.urlSlug === slug),
        ).filter((poet): poet is Poet => Boolean(poet));
    const featuredEntries = featuredPoets.map((poet) => {
      const match = classicEntries.find(
        (entry) => entry.poet.id === poet.id && entry.poet.urlSlug === poet.urlSlug,
      );
      return match ?? toEntry(poet, "گنجور");
    });

    const modernEntries = [...customPoets, ...modernPoets]
      .filter((poet) => poet.published)
      .map((poet) =>
        toEntry(
          poet,
          poet.source === "custom" ? "شاعران معاصر" : poet.sourceGroupName || OTHER_MODERN_GROUP,
        ),
      )
      .sort(byName);

    const groupsOf = (entries: PoetEntry[]) =>
      Array.from(new Set(entries.map((entry) => entry.group))).map((label) => ({
        id: label,
        label,
      }));

    return {
      featured: featuredEntries,
      classic: classicEntries,
      modern: modernEntries,
      classicFilters: groupsOf(classicEntries),
      modernFilters: groupsOf(modernEntries).sort((a, b) => a.label.localeCompare(b.label, "fa")),
    };
  }, [centuries, customPoets, modernPoets]);

  const allEntries = useMemo(() => [...classic, ...modern], [classic, modern]);
  const preferred = useMemo(
    () =>
      allEntries.filter(
        (entry) => entry.poetKey && settings.preferredPoetKeys.includes(entry.poetKey),
      ),
    [allEntries, settings.preferredPoetKeys],
  );

  const filters: PoetFilterOption[] =
    tab === "classic" ? classicFilters : tab === "modern" ? modernFilters : [];
  const activeFilter = filters.some((option) => option.id === filter) ? filter : ALL_FILTER_ID;

  const normalizedQuery = normalize(query);
  const tabEntries =
    tab === "featured"
      ? featured
      : tab === "classic"
        ? classic
        : tab === "modern"
          ? modern
          : preferred;
  const visible = normalizedQuery
    ? allEntries.filter((entry) => entry.searchText.includes(normalizedQuery))
    : activeFilter === ALL_FILTER_ID
      ? tabEntries
      : tabEntries.filter((entry) => entry.group === activeFilter);

  const tabs: { id: PoetsTab; label: string; count: number }[] = [
    { id: "featured", label: "محبوب", count: featured.length },
    { id: "classic", label: "کهن", count: classic.length },
    { id: "modern", label: "نو و جهان", count: modern.length },
    { id: "preferred", label: "علاقه‌مندی‌ها", count: preferred.length },
  ];

  const handleChipWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.currentTarget.scrollLeft -= event.deltaY;
  };

  const viewToggle = (
    <div className="app-segmented poets-view-toggle" role="group" aria-label="شیوه نمایش" data-view={view}>
      <span className="poets-view-thumb" aria-hidden="true" />
      <button
        type="button"
        aria-pressed={view === "grid"}
        aria-label="نمایش شبکه‌ای"
        title="شبکه‌ای"
        onClick={() => setView("grid")}
      >
        <FaThLarge aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-pressed={view === "list"}
        aria-label="نمایش فهرستی"
        title="فهرستی"
        onClick={() => setView("list")}
      >
        <FaListUl aria-hidden="true" />
      </button>
    </div>
  );

  return (
    <AppPage
      title="شاعران"
      subtitle={`${persianNumber.format(allEntries.length)} شاعر از گنجور و اکولالیا. علاقه‌مندی‌هایتان را نشان کنید تا فید «علاقه‌مندی‌ها» از آن‌ها پر شود.`}
      width="wide"
      className="poets-page"
      headerExtra={
        <div className="poets-controls">
          <label className="app-search-field poets-search">
            <FaSearch aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="جست‌وجوی نام شاعر"
              aria-label="جست‌وجوی نام شاعر"
              enterKeyHint="search"
            />
            {query && (
              <button
                type="button"
                className="poets-search-clear"
                onClick={() => setQuery("")}
                aria-label="پاک کردن"
              >
                <FaTimes aria-hidden="true" />
              </button>
            )}
          </label>
          <div className="poets-tabs-row">
          {!normalizedQuery && (
            <Tabs
              value={tab}
              onValueChange={(value) => {
                setTab(value as typeof tab);
                setFilter(ALL_FILTER_ID);
              }}
              className="min-w-0 flex-1"
            >
              <TabsList className="poets-tabs relative" aria-label="دسته‌های شاعران" onWheel={handleChipWheel}>
              <TabsIndicator />
              {tabs.map((item) => (
                <TabsTab
                  key={item.id}
                  value={item.id}
                  className="relative data-active:bg-transparent data-active:shadow-none"
                >
                  {item.label}
                  {item.id === "preferred" && item.count > 0 && (
                    <span className="poets-tab-count">{persianNumber.format(item.count)}</span>
                  )}
                </TabsTab>
              ))}
              </TabsList>
            </Tabs>
          )}
            {viewToggle}
          </div>
        </div>
      }
    >
      {!normalizedQuery && filters.length > 1 && (
        <div
          className="poets-chips modern-scrollbar"
          role="group"
          aria-label="فیلتر شاعران"
          onWheel={handleChipWheel}
        >
          {[{ id: ALL_FILTER_ID, label: "همه" }, ...filters].map((option) => (
            <button
              key={option.id}
              type="button"
              className="poets-chip"
              aria-pressed={activeFilter === option.id}
              onClick={() => setFilter(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      <div className="app-section-title poets-result-meta">
        <span>
          {normalizedQuery
            ? `نتیجه برای «${query.trim()}»`
            : activeFilter !== ALL_FILTER_ID
              ? activeFilter
              : tabs.find((item) => item.id === tab)?.label}
        </span>
        <span>{persianNumber.format(visible.length)} شاعر</span>
      </div>

      {visible.length > 0 ? (
        // Re-keyed per tab, filter and view so the new list fades in; typing a search keeps it.
        <div key={normalizedQuery ? "search" : `${tab}:${activeFilter}:${view}`} className="poets-collection">
          <PoetCollection entries={visible} view={view} />
        </div>
      ) : (
        <Empty>
          <EmptyIcon>{normalizedQuery ? <FaSearch /> : <FaPlus />}</EmptyIcon>
          <EmptyDescription>
            {normalizedQuery
              ? "شاعری با این نام پیدا نشد."
              : tab === "preferred"
                ? "هنوز شاعری را به علاقه‌مندی‌ها نیفزوده‌اید. روی «علاقه‌مندم» هر شاعر بزنید."
                : "فهرست این بخش دریافت نشد. کمی بعد دوباره سر بزنید."}
          </EmptyDescription>
          {tab === "preferred" && !normalizedQuery && (
            <Button variant="secondary" onClick={() => setTab("featured")}>
              دیدن شاعران محبوب
            </Button>
          )}
        </Empty>
      )}
    </AppPage>
  );
}
