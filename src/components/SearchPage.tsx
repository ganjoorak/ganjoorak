"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
} from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  FaExclamationCircle,
  FaFeatherAlt,
  FaHistory,
  FaRedoAlt,
  FaSearch,
  FaTimes,
} from "react-icons/fa";
import AppPage from "@/components/AppPage";
import ganjoorApi from "@/api/GanjoorApi";
import { HitCard, HitSkeleton, PoetAvatar, PoetPill, SOURCE_LABELS } from "@/components/SearchHits";
import { usePoemSearch } from "@/hooks/usePoemSearch";
import type { PoemLibrarySource } from "@/utils/poemLibrary";
import {
  findDirectoryPoet,
  getDirectoryPoetDisplayName,
  getPoetDirectory,
  getStaticPoetDirectory,
  loadPoetDirectory,
  type DirectoryPoet,
} from "@/utils/poetDirectory";
import { matchPoets, mergeHits } from "@/utils/searchClient";
import {
  clearRecentSearches,
  forgetRecentSearch,
  readRecentSearches,
  rememberRecentSearch,
} from "@/utils/recentSearches";
import {
  MIN_SEARCH_QUERY_LENGTH,
  formatPersianNumber,
  normalizeSearchText,
} from "@/utils/searchText";
import { logger } from "@/utils/logger";
import {
  type SourceFilter,
  type SearchMode,
  SOURCE_FILTERS,
  SEARCH_MODES,
  type SearchParamsState,
  type SearchParamsUpdate,
  emptySearchState,
  applySearchUpdate,
  readSearchParams,
  searchHref,
} from "@/components/search/searchState";
import { type SemanticState, semanticCache, idleSemantic } from "@/components/search/semantic";
import {
  EXAMPLE_QUERIES,
  EXAMPLE_SEMANTIC_QUERIES,
  POET_SCOPE_SLUGS,
  SEMANTIC_TOP_K,
  SEMANTIC_DELAY_MS,
  URL_DELAY_MS,
} from "@/components/search/searchConfig";
import {
  arrivedViaHistory,
  readStoredScroll,
  writeStoredScroll,
} from "@/components/search/searchScroll";
import { buildPlan } from "@/components/search/searchPlan";
import { PoetCombobox } from "@/components/search/PoetCombobox";
import { Segmented } from "@/components/search/Segmented";
import { SemanticCard } from "@/components/search/SemanticCard";
import "@/styles/SearchPage.css";

interface SearchViewProps {
  variant: "page" | "dialog";
  state: SearchParamsState;
  onChange: (next: SearchParamsUpdate) => void;
  /** Called when a result is opened (the dialog closes itself). */
  onNavigate?: () => void;
  /** Lets the dialog hand the field to its focus management. */
  inputRef?: MutableRefObject<HTMLInputElement | null>;
}

export function SearchView({ variant, state, onChange, onNavigate, inputRef: externalInputRef }: SearchViewProps) {
  const isPage = variant === "page";
  const urlQuery = state.q;
  const urlPoetKey = state.poet;
  const exact = state.exact;
  const mode = state.mode;
  const globalScope = state.global;
  const sourceFilter = state.source;

  const [draft, setDraft] = useState(urlQuery);
  const query = useDeferredValue(draft);
  // Hydration: the first render must match the server, which only has the bundled directory;
  // the session's enriched copy (Ganjoor pen names) is swapped in after mount.
  const [directory, setDirectory] = useState<DirectoryPoet[]>(getStaticPoetDirectory);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [semantic, setSemantic] = useState<SemanticState>(idleSemantic);
  const [semanticRetry, setSemanticRetry] = useState(0);
  const [isCompact, setIsCompact] = useState(false);

  const ownInputRef = useRef<HTMLInputElement | null>(null);
  const inputRef = externalInputRef ?? ownInputRef;
  const listRef = useRef<HTMLUListElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const stickySentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const lastWrittenQueryRef = useRef(urlQuery.trim());
  const restoreScrollRef = useRef<number | null>(null);

  useEffect(() => {
    setRecentSearches(readRecentSearches());
    setDirectory(getPoetDirectory());
    let cancelled = false;
    loadPoetDirectory().then((next) => {
      if (!cancelled) setDirectory(next);
    });
    if (isPage) {
      const stored = readStoredScroll();
      if (stored && stored.href === `${window.location.pathname}${window.location.search}` && arrivedViaHistory()) {
        restoreScrollRef.current = stored.y;
      }
      writeStoredScroll(null);
      // Autofocus only where a keyboard is already present; don't pop the mobile keyboard.
      if (!urlQuery && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
        inputRef.current?.focus();
      }
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const node = stickySentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => {
      setIsCompact(!entry.isIntersecting && entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const updateParams = useCallback(
    (next: SearchParamsUpdate) => {
      if (next.q !== undefined) lastWrittenQueryRef.current = next.q.trim();
      onChange(next);
    },
    [onChange],
  );

  // Back/forward or a link pushes a new query into the URL; mirror it into the field.
  useEffect(() => {
    if (urlQuery.trim() !== lastWrittenQueryRef.current) {
      lastWrittenQueryRef.current = urlQuery.trim();
      setDraft(urlQuery);
    }
  }, [urlQuery]);

  // Results follow the field directly; the URL catches up once typing pauses.
  useEffect(() => {
    if (draft.trim() === lastWrittenQueryRef.current) return;
    const timer = window.setTimeout(() => updateParams({ q: draft, exact: false }), URL_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [draft, updateParams]);

  const rememberQuery = useCallback((value: string) => {
    if (normalizeSearchText(value).length >= MIN_SEARCH_QUERY_LENGTH) {
      setRecentSearches(rememberRecentSearch(value));
    }
  }, []);

  const submitQuery = useCallback(
    (value: string) => {
      setDraft(value);
      updateParams({ q: value, exact: false });
      rememberQuery(value);
    },
    [rememberQuery, updateParams],
  );

  const selectedPoet = useMemo(() => findDirectoryPoet(urlPoetKey, directory), [directory, urlPoetKey]);
  const plan = useMemo(
    () => buildPlan(query, selectedPoet, exact, directory),
    [directory, exact, query, selectedPoet],
  );
  const isSemantic = mode === "semantic";
  const keywordActive = plan.shouldSearch && !isSemantic;
  const poet = plan.poet;
  const allows = (source: PoemLibrarySource) =>
    (sourceFilter === "all" || sourceFilter === source) && (!poet || poet.source === source);

  const { local, ganjoor, loadMore, retry } = usePoemSearch({
    term: keywordActive ? plan.term : "",
    local: allows("custom") || allows("echolalia"),
    localSource: sourceFilter === "custom" || sourceFilter === "echolalia" ? sourceFilter : null,
    localPoet: poet && poet.source !== "ganjoor" ? poet.urlSlug : null,
    ganjoor: allows("ganjoor"),
    ganjoorPoetId: poet?.source === "ganjoor" ? poet.id : null,
  });

  const poets = useMemo(
    () => (keywordActive && !poet ? matchPoets(plan.normalizedQuery, directory, 10) : []),
    [directory, keywordActive, plan.normalizedQuery, poet],
  );
  const hits = useMemo(
    () => mergeHits(plan.term, local.hits, ganjoor.hits, ganjoor.firstPage),
    [ganjoor.firstPage, ganjoor.hits, local.hits, plan.term],
  );
  const scopePoets = useMemo(
    () =>
      POET_SCOPE_SLUGS.map((slug) => directory.find((entry) => entry.key === slug)).filter(
        (entry): entry is DirectoryPoet => Boolean(entry),
      ),
    [directory],
  );

  // Semantic search: one slower request to ganjgah.ir via our proxy, so it waits for a pause.
  const semanticKey = isSemantic && plan.shouldSearch
    ? [query.trim(), selectedPoet?.key ?? "", globalScope ? "g" : ""].join("|")
    : null;
  useEffect(() => {
    if (!semanticKey) {
      setSemantic(idleSemantic);
      return;
    }
    const cached = semanticCache.get(semanticKey);
    if (cached) {
      setSemantic(cached);
      return;
    }
    const controller = new AbortController();
    setSemantic((previous) => ({ ...previous, status: "loading" }));
    const timer = window.setTimeout(() => {
      ganjoorApi
        .searchPoemsSemantic(query.trim(), {
          topK: SEMANTIC_TOP_K,
          poetId: selectedPoet?.source === "ganjoor" ? selectedPoet.id : undefined,
          disableScopeDetection: globalScope,
          signal: controller.signal,
        })
        .then((page) => {
          const next: SemanticState = {
            status: "done",
            scopePoet: page.detectedPoetName,
            scopeCategory: page.detectedCategoryName,
            hits: page.results.map((poem) => ({
              key: `semantic:${poem.poemId}`,
              id: poem.poemId,
              title: poem.title,
              poetName: poem.poetName,
              avatarUrl: directory.find((entry) => entry.key === poem.poetSlug)?.imageUrl ?? null,
              collection: poem.bookTitle,
              href: `/poem/${poem.poemId}`,
              verses: poem.verses,
            })),
          };
          semanticCache.set(semanticKey, next);
          setSemantic(next);
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          logger.error("Semantic search failed:", error);
          setSemantic({ ...idleSemantic, status: "error" });
        });
    }, SEMANTIC_DELAY_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
    // semanticKey captures query, poet and scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semanticKey, semanticRetry]);

  const localWanted = allows("custom") || allows("echolalia");
  const ganjoorWanted = allows("ganjoor");
  const localPending = localWanted && (local.status === "loading" || local.status === "idle");
  const ganjoorPending = ganjoorWanted && (ganjoor.status === "loading" || ganjoor.status === "idle");
  const keywordBusy = keywordActive && (localPending || ganjoorPending || ganjoor.loadingMore);
  const isBusy = keywordBusy || (isSemantic && semantic.status === "loading");
  const keywordSettled = keywordActive && !localPending && !ganjoorPending;
  const ganjoorFailed = ganjoorWanted && ganjoor.status === "error";
  const localFailed = localWanted && local.status === "error";
  const showKeywordEmpty = keywordSettled && hits.length === 0 && poets.length === 0 && !ganjoorFailed;
  // Dim only what may belong to the previous query; local hits are fresh while Ganjoor catches up.
  const hitsAreStale = keywordActive && hits.length > 0 && local.status === "loading";

  const ganjoorTotal = ganjoor.phraseTotal ?? ganjoor.wordsTotal ?? 0;
  const sourceCounts: Partial<Record<SourceFilter, number | null>> = keywordSettled
    ? {
        ganjoor: ganjoorWanted ? ganjoorTotal : null,
        echolalia: localWanted ? local.counts.echolalia : null,
        custom: localWanted ? local.counts.custom : null,
      }
    : {};

  // Infinite scroll for Ganjoor's later pages.
  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !ganjoor.next) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ganjoor.next, hits.length, loadMore]);

  // Back from a poem: put the list where it was once it has rendered.
  useEffect(() => {
    const target = restoreScrollRef.current;
    if (target === null || hits.length === 0) return;
    restoreScrollRef.current = null;
    window.requestAnimationFrame(() => window.scrollTo({ top: target, behavior: "auto" }));
  }, [hits.length]);

  const handleResultClick = useCallback(() => {
    if (isPage) {
      writeStoredScroll({
        href: `${window.location.pathname}${window.location.search}`,
        y: Math.round(window.scrollY),
      });
    }
    rememberQuery(query);
    onNavigate?.();
  }, [isPage, onNavigate, query, rememberQuery]);

  const focusResult = (offset: number, from?: HTMLElement | null) => {
    const links = Array.from(
      resultsRef.current?.querySelectorAll<HTMLAnchorElement>("a.search-hit-link, a.search-poet-pill") ?? [],
    );
    if (links.length === 0) return false;
    const currentIndex = from ? links.indexOf(from as HTMLAnchorElement) : -1;
    const nextIndex = currentIndex + offset;
    if (nextIndex < 0) {
      inputRef.current?.focus();
      return true;
    }
    links[Math.min(nextIndex, links.length - 1)]?.focus();
    return true;
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (draft) {
        setDraft("");
        updateParams({ q: "" });
      } else {
        inputRef.current?.blur();
      }
    } else if (event.key === "ArrowDown" && focusResult(1, null)) {
      event.preventDefault();
    }
  };

  const handleResultsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const target = (event.target as HTMLElement).closest<HTMLElement>("a");
    if (!target) return;
    event.preventDefault();
    focusResult(event.key === "ArrowDown" ? 1 : -1, target);
  };

  const handleModeChange = useCallback(
    (value: SearchMode) => {
      updateParams({
        mode: value,
        source: value === "semantic" ? "all" : undefined,
        poet: value === "semantic" && selectedPoet && selectedPoet.source !== "ganjoor" ? null : undefined,
        exact: value === "semantic" ? false : undefined,
        global: value === "keyword" ? false : undefined,
      });
    },
    [selectedPoet, updateParams],
  );

  const poetLabel = poet ? getDirectoryPoetDisplayName(poet) : null;
  const exampleQueries = isSemantic ? EXAMPLE_SEMANTIC_QUERIES : EXAMPLE_QUERIES;
  const semanticScopeLabel = [semantic.scopePoet, semantic.scopeCategory].filter(Boolean).join(" » ");
  const poetOptions = isSemantic ? directory.filter((entry) => entry.source === "ganjoor") : directory;

  const summary = (() => {
    if (!keywordActive || hits.length === 0) return null;
    const parts: string[] = [];
    if (ganjoorWanted && ganjoor.status === "done") {
      if (ganjoor.phraseTotal != null) {
        parts.push(`${formatPersianNumber(ganjoor.phraseTotal)} شعر با عین عبارت در گنجور`);
        if (ganjoor.wordsTotal) parts.push(`${formatPersianNumber(ganjoor.wordsTotal)} با همهٔ واژه‌ها`);
      } else if (ganjoor.wordsTotal != null) {
        parts.push(`${formatPersianNumber(ganjoor.wordsTotal)} شعر در گنجور`);
      }
    }
    if (localWanted && local.status === "done" && local.total > 0) {
      parts.push(`${formatPersianNumber(local.total)} در شعر معاصر و محلی`);
    }
    return parts.join(" · ");
  })();

  return (
      <div className={`search-page-shell is-${variant}${plan.shouldSearch ? " has-query" : ""}`}>
        <div ref={stickySentinelRef} className="search-sticky-sentinel" aria-hidden="true" />
        <div className={`search-bar${isCompact ? " is-compact" : ""}`}>
          <form
            className="search-field"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              submitQuery(draft);
              inputRef.current?.blur();
            }}
          >
            <FaSearch className="search-field-icon" aria-hidden="true" />
            <input
              ref={inputRef}
              type="search"
              dir="rtl"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder={isSemantic ? "موضوع یا حال‌وهوای شعر…" : "نام شاعر، مصرع یا واژه…"}
              aria-label="جست‌وجوی شعر"
              autoComplete="off"
              enterKeyHint="search"
              spellCheck={false}
            />
            <span className={`search-field-progress${isBusy ? " is-active" : ""}`} aria-hidden="true" />
            <AnimatePresence>
              {draft && (
                <motion.button
                  type="button"
                  className="search-field-clear"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.14 }}
                  onClick={() => {
                    setDraft("");
                    updateParams({ q: "" });
                    inputRef.current?.focus();
                  }}
                  aria-label="پاک کردن جست‌وجو"
                >
                  <FaTimes aria-hidden="true" />
                </motion.button>
              )}
            </AnimatePresence>
          </form>

          <div className="search-filters">
            <Segmented label="شیوه" options={SEARCH_MODES} value={mode} onChange={handleModeChange} />
            {!isSemantic && (
              <Segmented
                label="منبع"
                options={SOURCE_FILTERS}
                value={sourceFilter}
                onChange={(value) => updateParams({ source: value })}
                counts={sourceCounts}
              />
            )}
            <PoetCombobox
              poets={poetOptions}
              value={selectedPoet}
              onChange={(next) => updateParams({ poet: next ? next.key : null })}
            />
          </div>
        </div>

        <div ref={resultsRef} className="search-results-area" onKeyDown={handleResultsKeyDown}>
          {!plan.shouldSearch && (
            <section className="search-start" aria-label="شروع جست‌وجو">
              {recentSearches.length > 0 && (
                <div className="search-start-group">
                  <div className="search-start-heading">
                    <h2>
                      <FaHistory aria-hidden="true" />
                      جست‌وجوهای اخیر
                    </h2>
                    <button
                      type="button"
                      className="search-text-button"
                      onClick={() => setRecentSearches(clearRecentSearches())}
                    >
                      پاک کردن
                    </button>
                  </div>
                  <ul className="search-chip-row">
                    {recentSearches.map((item) => (
                      <li key={item} className="search-chip search-chip-recent">
                        <button type="button" onClick={() => submitQuery(item)}>
                          {item}
                        </button>
                        <button
                          type="button"
                          className="search-chip-remove"
                          aria-label={`حذف «${item}» از جست‌وجوهای اخیر`}
                          onClick={() => setRecentSearches(forgetRecentSearch(item))}
                        >
                          <FaTimes aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="search-start-group">
                <div className="search-start-heading">
                  <h2>
                    <FaFeatherAlt aria-hidden="true" />
                    {isSemantic ? "چند موضوع برای شروع" : "چند جست‌وجو برای شروع"}
                  </h2>
                </div>
                <ul className="search-chip-row">
                  {exampleQueries.map((example) => (
                    <li key={example}>
                      <button type="button" className="search-chip" onClick={() => submitQuery(example)}>
                        {example}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="search-start-hint">
                {isSemantic
                  ? "در «معنا» حال‌وهوا را بنویسید، نه لزوماً واژه‌های شعر را؛ نام شاعر را هم می‌توانید بیاورید."
                  : "نام شاعر را کنار واژه بنویسید تا فقط در اشعار او بگردد؛ مثل «حافظ عشق». «ی» و «ک» عربی و فارسی یکی‌اند."}
              </p>
            </section>
          )}

          {keywordActive && (
            <>
              {(plan.poetFromIntent || exact) && (
                <div className="search-intent">
                  {plan.poetFromIntent && poet ? (
                    <>
                      <span>«{plan.term}» در اشعار</span>
                      <span className="search-intent-chip">
                        <PoetAvatar src={poet.imageUrl} name={poetLabel!} size={18} />
                        {poetLabel}
                      </span>
                      <button type="button" className="search-text-button" onClick={() => updateParams({ exact: true })}>
                        جست‌وجوی عین عبارت
                      </button>
                    </>
                  ) : (
                    <>
                      <span>جست‌وجوی عین عبارت</span>
                      <button type="button" className="search-text-button" onClick={() => updateParams({ exact: false })}>
                        تشخیص شاعر از عبارت
                      </button>
                    </>
                  )}
                </div>
              )}

              <AnimatePresence initial={false}>
                {poets.length > 0 && (
                  <motion.section
                    key="poets"
                    className="search-section"
                    aria-label="شاعران"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}
                  >
                    <h2 className="search-section-title">شاعران</h2>
                    <div className="search-poet-row" onClickCapture={handleResultClick}>
                      {poets.map((entry) => (
                        <PoetPill key={entry.key} poet={entry} query={plan.normalizedQuery} />
                      ))}
                    </div>
                  </motion.section>
                )}
              </AnimatePresence>

              <section className="search-section" aria-label="شعرها">
                <div className="search-section-head">
                  <h2 className="search-section-title">
                    {poet ? `شعرهای ${poetLabel}` : "شعرها"}
                  </h2>
                  {summary && (
                    <p className={`search-summary${hitsAreStale ? " is-stale" : ""}`} aria-live="polite">
                      {summary}
                    </p>
                  )}
                </div>

                {!poet && ganjoorWanted && plan.term.split(" ").length === 1 && hits.length > 0 && (
                  <div className="search-scope-row" aria-label="جست‌وجو در اشعار یک شاعر">
                    <span>فقط در:</span>
                    {scopePoets.map((entry) => (
                      <button
                        key={entry.key}
                        type="button"
                        className="search-chip is-small"
                        onClick={() => updateParams({ poet: entry.key })}
                      >
                        {getDirectoryPoetDisplayName(entry)}
                      </button>
                    ))}
                  </div>
                )}

                {(ganjoorFailed || localFailed) && (
                  <p className="search-notice" role="alert">
                    <FaExclamationCircle aria-hidden="true" />
                    <span>
                      {ganjoorFailed && localFailed
                        ? "جست‌وجو کامل نشد."
                        : ganjoorFailed
                          ? "گنجور پاسخ نداد؛ نتایج محلی نمایش داده شد."
                          : "جست‌وجوی محلی ناموفق بود."}
                    </span>
                    <button type="button" className="search-text-button" onClick={retry}>
                      <FaRedoAlt aria-hidden="true" />
                      تلاش دوباره
                    </button>
                  </p>
                )}

                {showKeywordEmpty && (
                  <div className="search-state">
                    <FaFeatherAlt aria-hidden="true" />
                    <h3>چیزی پیدا نشد</h3>
                    <p>
                      برای «{plan.term}»
                      {poet ? ` در اشعار ${poetLabel}` : sourceFilter !== "all" ? ` در ${SOURCE_LABELS[sourceFilter]}` : ""} نتیجه‌ای نبود.
                      واژه‌های کمتری بنویسید یا املا را بررسی کنید.
                    </p>
                    <div className="search-state-actions">
                      {poet && (
                        <button
                          type="button"
                          className="search-chip"
                          onClick={() => (plan.poetFromIntent ? updateParams({ exact: true }) : updateParams({ poet: null }))}
                        >
                          جست‌وجو در همهٔ شاعران
                        </button>
                      )}
                      {sourceFilter !== "all" && (
                        <button type="button" className="search-chip" onClick={() => updateParams({ source: "all" })}>
                          جست‌وجو در همهٔ منابع
                        </button>
                      )}
                      <button type="button" className="search-chip" onClick={() => handleModeChange("semantic")}>
                        جست‌وجوی معنایی
                      </button>
                    </div>
                  </div>
                )}

                <ul ref={listRef} className={`search-hits${hitsAreStale ? " is-stale" : ""}`} onClickCapture={handleResultClick}>
                  {hits.map((hit, index) => (
                    <HitCard key={hit.key} hit={hit} query={plan.term} index={index} />
                  ))}
                  {(hits.length === 0 ? keywordBusy : ganjoorWanted && ganjoor.status === "loading") &&
                    Array.from({ length: hits.length === 0 ? 5 : 2 }, (_, index) => <HitSkeleton key={`s-${index}`} />)}
                  {ganjoor.loadingMore && Array.from({ length: 2 }, (_, index) => <HitSkeleton key={`m-${index}`} />)}
                </ul>
                {hits.length > 0 && ganjoorWanted && ganjoor.status === "loading" && (
                  <p className="search-pending">در حال جست‌وجو در گنجور…</p>
                )}
                {ganjoor.loadMoreError && (
                  <p className="search-notice">
                    <span>بارگذاری نتایج بیشتر ناموفق بود.</span>
                    <button type="button" className="search-text-button" onClick={loadMore}>
                      تلاش دوباره
                    </button>
                  </p>
                )}
                {ganjoor.next && !ganjoor.loadingMore && !ganjoor.loadMoreError && (
                  <button type="button" className="search-more" onClick={loadMore}>
                    نتایج بیشتر از گنجور
                  </button>
                )}
                <div ref={loadMoreRef} className="search-load-more-sentinel" aria-hidden="true" />
              </section>
            </>
          )}

          {isSemantic && plan.shouldSearch && (
            <section className="search-section" aria-label="نتایج معنایی">
              {semantic.status === "done" && semanticScopeLabel && !selectedPoet && (
                <div className="search-intent">
                  <span>محدود به</span>
                  <span className="search-intent-chip">{semanticScopeLabel}</span>
                  <button type="button" className="search-text-button" onClick={() => updateParams({ global: true })}>
                    جست‌وجو در همه
                  </button>
                </div>
              )}
              {globalScope && (
                <div className="search-intent">
                  <span>جست‌وجو در همهٔ گنجور</span>
                  <button type="button" className="search-text-button" onClick={() => updateParams({ global: false })}>
                    تشخیص شاعر از عبارت
                  </button>
                </div>
              )}
              {semantic.status === "error" && (
                <p className="search-notice" role="alert">
                  <FaExclamationCircle aria-hidden="true" />
                  <span>جست‌وجوی معنایی پاسخ نداد.</span>
                  <button type="button" className="search-text-button" onClick={() => setSemanticRetry((token) => token + 1)}>
                    <FaRedoAlt aria-hidden="true" />
                    تلاش دوباره
                  </button>
                </p>
              )}
              {semantic.status === "done" && semantic.hits.length === 0 && (
                <div className="search-state">
                  <FaFeatherAlt aria-hidden="true" />
                  <h3>چیزی پیدا نشد</h3>
                  <p>موضوع را کلی‌تر بنویسید، یا اگر مصرع را می‌دانید، با «واژه» بگردید.</p>
                </div>
              )}
              <ul className={`search-hits${semantic.status === "loading" && semantic.hits.length > 0 ? " is-stale" : ""}`}>
                {semantic.hits.map((hit, index) => (
                  <SemanticCard key={hit.key} hit={hit} index={index} onClick={handleResultClick} />
                ))}
                {semantic.status === "loading" &&
                  semantic.hits.length === 0 &&
                  Array.from({ length: 4 }, (_, index) => <HitSkeleton key={index} />)}
              </ul>
              {semantic.status === "loading" && (
                <p className="search-pending">جست‌وجوی معنایی چند ثانیه طول می‌کشد…</p>
              )}
            </section>
          )}
        </div>
      </div>
  );
}

const SearchPage = () => {
  const searchParams = useSearchParams();
  const state = useMemo(() => readSearchParams(searchParams), [searchParams]);
  const handleChange = useCallback((next: SearchParamsUpdate) => {
    const href = searchHref(applySearchUpdate(readSearchParams(new URLSearchParams(window.location.search)), next));
    if (`${window.location.pathname}${window.location.search}` !== href) {
      // Native history works with useSearchParams and skips a server round-trip per keystroke.
      // The state must be null, or Next's patched replaceState treats it as its own and ignores it.
      window.history.replaceState(null, "", href);
    }
  }, []);

  return (
    <AppPage title="جست‌وجو" subtitle="شاعر، مصرع یا یک واژه؛ در گنجور، اکولالیا و شاعران محلی." className="search-page">
      <SearchView variant="page" state={state} onChange={handleChange} />
    </AppPage>
  );
};

/** The same search in local state, for the dialog opened from the floating search buttons. */
export function useSearchDialogState() {
  const [state, setState] = useState<SearchParamsState>(emptySearchState);
  const onChange = useCallback(
    (next: SearchParamsUpdate) => setState((current) => applySearchUpdate(current, next)),
    [],
  );
  return { state, onChange };
}

export default SearchPage;
