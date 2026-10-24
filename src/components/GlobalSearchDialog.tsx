"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FaBookOpen,
  FaFeatherAlt,
  FaSearch,
  FaTimes,
  FaTimesCircle,
  FaUser,
} from "react-icons/fa";
import ganjoorApi from "@/api/GanjoorApi";
import customApi from "@/api/CustomApi";
import echolaliaApi from "@/api/EcholaliaApi";
import type { GanjoorCategory, GanjoorPoemSearchResult } from "@/types/ganjoor";
import type { Poet } from "@/types/poet";
import { PoetSlug } from "@/types/poet";
import { logger } from "@/utils/logger";
import {
  MIN_SEARCH_QUERY_LENGTH,
  normalizeSearchText,
} from "@/utils/searchText";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogPopup, DialogTitle } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-error";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";

type SearchFilter = "all" | "poets" | "poems" | "books";

interface LocalPoemSearchResult {
  id: number;
  title: string;
  poetName: string;
  poetSlug: string;
  excerpt: string;
  collection: string | null;
  source: "custom" | "echolalia";
}

interface BookSearchResult {
  key: string;
  title: string;
  poetName: string;
  href: string;
}

interface SearchState {
  poets: Poet[];
  poems: Array<GanjoorPoemSearchResult | LocalPoemSearchResult>;
  books: BookSearchResult[];
}

interface GlobalSearchDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialFilter?: SearchFilter;
}

const SEARCH_FILTERS: Array<{ value: SearchFilter; label: string }> = [
  { value: "all", label: "همه" },
  { value: "poets", label: "شاعران" },
  { value: "poems", label: "شعرها" },
  { value: "books", label: "دفترها" },
];

const SEARCH_FILTER_PARAM = "sf";

const isSearchFilter = (value: string | null): value is SearchFilter =>
  SEARCH_FILTERS.some((option) => option.value === value);

const readFilterFromUrl = (fallback: SearchFilter): SearchFilter => {
  if (typeof window === "undefined") {
    return fallback;
  }

  const value = new URLSearchParams(window.location.search).get(
    SEARCH_FILTER_PARAM,
  );

  return isSearchFilter(value) ? value : fallback;
};

const writeFilterToUrl = (value: SearchFilter | null) => {
  if (typeof window === "undefined") {
    return;
  }

  const params = new URLSearchParams(window.location.search);

  if (!value || value === "all") {
    params.delete(SEARCH_FILTER_PARAM);
  } else {
    params.set(SEARCH_FILTER_PARAM, value);
  }

  const search = params.toString();
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`,
  );
};

const getPoetHref = (poet: Poet) => {
  if (/^https?:\/\//.test(poet.fullUrl)) {
    return poet.fullUrl;
  }

  const poetPath = poet.fullUrl.startsWith("/")
    ? poet.fullUrl
    : `/${poet.fullUrl || poet.urlSlug}`;
  return poetPath;
};

const getPoetSourcePriority = (poet: Poet) => {
  if (poet.source === "ganjoor" || !poet.source) return 0;
  if (poet.source === "custom") return 1;
  return 2;
};

const getPoemHref = (poem: GanjoorPoemSearchResult | LocalPoemSearchResult) => {
  if (!("fullUrl" in poem)) {
    return `/${poem.poetSlug}/${poem.id}`;
  }
  return `/poem/${poem.id}`;
};

const getResultExcerpt = (
  poem: GanjoorPoemSearchResult | LocalPoemSearchResult,
  query: string,
) => {
  if ("excerpt" in poem) {
    return poem.excerpt;
  }

  const lines = poem.plainText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const normalizedQuery = normalizeSearchText(query);
  const matchingLine = lines.find((line) =>
    normalizeSearchText(line).includes(normalizedQuery),
  );
  return matchingLine || poem.poemSummary || lines[0] || poem.fullTitle;
};

const poetMatchesQuery = (poet: Poet, query: string) =>
  normalizeSearchText(
    [
      poet.name,
      poet.nickname,
      poet.fullUrl,
      poet.urlSlug,
      poet.birthPlace,
      poet.deathPlace,
    ]
      .filter(Boolean)
      .join(" "),
  ).includes(query);

const uniqueBooks = (books: BookSearchResult[]) => {
  const map = new Map<string, BookSearchResult>();
  books.forEach((book) => {
    if (!map.has(book.key)) {
      map.set(book.key, book);
    }
  });
  return Array.from(map.values());
};

const flattenGanjoorBooks = (
  category: GanjoorCategory,
  poetName: string,
  poetSlug: string,
): BookSearchResult[] => {
  const children = category.children ?? [];
  const current =
    category.id > 0 && category.title
      ? [
          {
            key: `ganjoor-cat-${category.id}`,
            title: category.title,
            poetName,
            href: `/${poetSlug}`,
          },
        ]
      : [];

  return [
    ...current,
    ...children.flatMap((child) => flattenGanjoorBooks(child, poetName, poetSlug)),
  ];
};

const searchGanjoorBooks = async (
  query: string,
  poets: Poet[],
): Promise<BookSearchResult[]> => {
  const candidatePoets = poets
    .filter((poet) => poet.source === "ganjoor" || !poet.source)
    .filter((poet) => poet.published && poetMatchesQuery(poet, query))
    .slice(0, 6);

  const catalogs = await Promise.allSettled(
    candidatePoets.map(async (poet) => {
      const catalog = await ganjoorApi.getPoetCatalog(poet.urlSlug, poet.id);
      return {
        poet,
        catalog,
      };
    }),
  );

  return catalogs.flatMap((result) => {
    if (result.status !== "fulfilled") {
      return [];
    }

    const { poet, catalog } = result.value;
    return flattenGanjoorBooks(
      catalog.category,
      poet.nickname || poet.name,
      catalog.poet.urlSlug || poet.urlSlug,
    ).filter((book) =>
      normalizeSearchText(`${book.title} ${book.poetName}`).includes(query),
    );
  });
};

const searchLocalPoemsAndBooks = async (
  query: string,
): Promise<{
  poems: LocalPoemSearchResult[];
  books: BookSearchResult[];
}> => {
  const poetSlugs = Object.values(PoetSlug);
  const datasets = await Promise.allSettled(
    poetSlugs.map(async (slug) => ({
      slug,
      data: await customApi._getPoetData(slug),
    })),
  );
  const poems: LocalPoemSearchResult[] = [];
  const books: BookSearchResult[] = [];

  datasets.forEach((result) => {
    if (result.status !== "fulfilled") {
      return;
    }

    const { slug, data } = result.value;
    const poetName = data?.poet || slug;
    const seenCollections = new Set<string>();

    (data?.poems ?? []).forEach((poem: any) => {
      const collection =
        typeof poem?.collection === "string" && poem.collection.trim()
          ? poem.collection.trim()
          : null;
      const haystack = normalizeSearchText(
        [poem?.title, poem?.text, collection, poetName].filter(Boolean).join(" "),
      );

      if (collection && !seenCollections.has(collection)) {
        seenCollections.add(collection);
        if (
          normalizeSearchText(`${collection} ${poetName}`).includes(query)
        ) {
          books.push({
            key: `local-${slug}-${collection}`,
            title: collection,
            poetName,
            href: `/${slug}`,
          });
        }
      }

      if (haystack.includes(query) && poems.length < 8) {
        const lines = String(poem?.text ?? "")
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        const matchingLine = lines.find((line) =>
          normalizeSearchText(line).includes(query),
        );
        poems.push({
          id: poem.id,
          title: poem.title,
          poetName,
          poetSlug: slug,
          excerpt: matchingLine || lines[0] || "",
          collection,
          source: "custom",
        });
      }
    });
  });

  return { poems, books };
};

const searchEcholaliaPoems = async (
  query: string,
): Promise<LocalPoemSearchResult[]> => {
  const poems = await echolaliaApi.searchPoems(query);
  return poems.map((poem) => {
    const lines = poem.plainText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const matchingLine = lines.find((line) =>
      normalizeSearchText(line).includes(normalizeSearchText(query)),
    );

    return {
      id: poem.id,
      title: poem.title,
      poetName: poem.poet,
      poetSlug: poem.poetSlug,
      excerpt: matchingLine || lines[0] || "",
      collection: "اکولالیا",
      source: "echolalia",
    };
  });
};

const deriveBooksFromPoems = (
  poems: GanjoorPoemSearchResult[],
  query: string,
) =>
  poems
    .filter((poem) => poem.bookTitle && poem.bookUrl)
    .filter((poem) =>
      normalizeSearchText(`${poem.bookTitle} ${poem.poetName}`).includes(query),
    )
    .map((poem) => ({
      key: `ganjoor-${poem.bookUrl}`,
      title: poem.bookTitle!,
      poetName: poem.poetName,
      href: `/${poem.poetSlug}`,
    }));

const emptyState: SearchState = {
  poets: [],
  poems: [],
  books: [],
};

const GlobalSearchDialog: React.FC<GlobalSearchDialogProps> = ({
  isOpen,
  onClose,
  initialFilter = "all",
}) => {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SearchFilter>(() =>
    readFilterFromUrl(initialFilter),
  );
  const [results, setResults] = useState<SearchState>(emptyState);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allPoets, setAllPoets] = useState<Poet[]>([]);
  const [hasLoadedPoets, setHasLoadedPoets] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const normalizedQuery = useMemo(() => normalizeSearchText(query), [query]);
  const shouldSearch = normalizedQuery.length >= MIN_SEARCH_QUERY_LENGTH;

  const goToFullSearch = () => {
    const trimmed = query.trim();
    if (normalizeSearchText(trimmed).length < MIN_SEARCH_QUERY_LENGTH) {
      return;
    }
    onClose();
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setFilter(readFilterFromUrl(initialFilter));
    const timer = window.setTimeout(() => inputRef.current?.focus(), 80);

    return () => {
      window.clearTimeout(timer);
      writeFilterToUrl(null);
    };
  }, [initialFilter, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    writeFilterToUrl(filter);
  }, [filter, isOpen]);

  useEffect(() => {
    if (!isOpen || allPoets.length > 0) {
      return;
    }

    let cancelled = false;

    const loadPoets = async () => {
      try {
        const [ganjoorPoets, customPoets, echolaliaPoets] = await Promise.all([
          ganjoorApi.getPoets(),
          customApi.getPoets(),
          echolaliaApi.getPoets(),
        ]);
        if (!cancelled) {
          setAllPoets([...ganjoorPoets, ...customPoets, ...echolaliaPoets]);
          setHasLoadedPoets(true);
        }
      } catch (loadError) {
        logger.error("Error loading poets for search:", loadError);
        if (!cancelled) {
          setHasLoadedPoets(true);
        }
      }
    };

    loadPoets();

    return () => {
      cancelled = true;
    };
  }, [allPoets.length, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (!shouldSearch) {
      setResults(emptyState);
      setError(null);
      setIsLoading(false);
      return;
    }

    if ((filter === "all" || filter === "poets") && !hasLoadedPoets) {
      setResults(emptyState);
      setError(null);
      setIsLoading(true);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      setError(null);

      try {
        const shouldSearchPoems = filter === "all" || filter === "poems";
        const shouldSearchBooks = filter === "all" || filter === "books";
        const shouldSearchPoets = filter === "all" || filter === "poets";

        const matchingPoets = shouldSearchPoets
          ? allPoets
              .filter((poet) => poet.published && poetMatchesQuery(poet, normalizedQuery))
              .sort((a, b) => {
                const sourceDelta = getPoetSourcePriority(a) - getPoetSourcePriority(b);
                if (sourceDelta !== 0) return sourceDelta;
                return (a.nickname || a.name).localeCompare(b.nickname || b.name, "fa");
              })
              .slice(0, 10)
          : [];

        if (!cancelled) {
          setResults({
            poets: matchingPoets,
            poems: [],
            books: [],
          });
          setIsLoading(shouldSearchPoems || shouldSearchBooks);
        }

        if (!shouldSearchPoems && !shouldSearchBooks) {
          return;
        }

        const [remotePoems, localResults, echolaliaPoems, ganjoorBookResults] = await Promise.all([
          shouldSearchPoems || shouldSearchBooks
            ? ganjoorApi.searchPoems(query, { pageSize: 14 }).then((page) => page.items)
            : Promise.resolve([]),
          shouldSearchPoems || shouldSearchBooks
            ? searchLocalPoemsAndBooks(normalizedQuery)
            : Promise.resolve({ poems: [], books: [] }),
          shouldSearchPoems ? searchEcholaliaPoems(query) : Promise.resolve([]),
          shouldSearchBooks
            ? searchGanjoorBooks(normalizedQuery, allPoets)
            : Promise.resolve([]),
        ]);

        const remoteBookResults = shouldSearchBooks
          ? deriveBooksFromPoems(remotePoems, normalizedQuery)
          : [];

        if (!cancelled) {
          setResults({
            poets: matchingPoets,
            poems: shouldSearchPoems
              ? [
                  ...remotePoems.slice(0, 12),
                  ...localResults.poems,
                  ...echolaliaPoems,
                ].slice(0, 18)
              : [],
            books: shouldSearchBooks
              ? uniqueBooks([
                  ...ganjoorBookResults,
                  ...remoteBookResults,
                  ...localResults.books,
                ]).slice(0, 12)
              : [],
          });
        }
      } catch (searchError) {
        logger.error("Global search failed:", searchError);
        if (!cancelled) {
          setError("جست‌وجو کامل نشد. کمی بعد دوباره تلاش کنید.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }, 260);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [allPoets, filter, hasLoadedPoets, isOpen, normalizedQuery, query, shouldSearch]);

  const hasResults =
    results.poets.length > 0 ||
    results.poems.length > 0 ||
    results.books.length > 0;
  const showLoadingMessage = isLoading && !hasResults;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup
        dir="rtl"
        showCloseButton={false}
        initialFocus={inputRef}
        className="h-[min(88dvh,46rem)] text-right sm:max-w-3xl"
      >
              <DialogHeader className="gap-3 border-b border-border pb-4">
                <div className="flex items-center justify-between gap-4">
                  <DialogTitle>جست‌وجو</DialogTitle>
                  <Button variant="ghost" size="icon" className="size-11" onClick={onClose} aria-label="بستن">
                    <FaTimes aria-hidden="true" />
                  </Button>
                </div>

              <form
                className="relative"
                onSubmit={(event) => {
                  event.preventDefault();
                  goToFullSearch();
                }}
              >
                <FaSearch aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-3.5 my-auto size-3.5 text-muted-foreground" />
                <Input
                  ref={inputRef}
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="نام شاعر، شعر یا دفتر..."
                  aria-label="جست‌وجوی سراسری"
                  className="h-12 ps-10 pe-11"
                />
                {query && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute inset-y-0 end-2 my-auto"
                    onClick={() => {
                      setQuery("");
                      inputRef.current?.focus();
                    }}
                    aria-label="پاک کردن جست‌وجو"
                  >
                    <FaTimesCircle aria-hidden="true" className="text-muted-foreground" />
                  </Button>
                )}
              </form>

              <div className="flex flex-wrap gap-2">
                {SEARCH_FILTERS.map((option) => (
                  <Toggle
                    key={option.value}
                    variant="outline"
                    size="sm"
                    className="rounded-full px-3 data-pressed:border-primary data-pressed:bg-primary data-pressed:text-primary-foreground"
                    pressed={filter === option.value}
                    onPressedChange={() => setFilter(option.value)}
                  >
                    {option.label}
                  </Toggle>
                ))}
              </div>
              </DialogHeader>

              <div className="global-search-results modern-scrollbar min-h-0 flex-1">
                {!shouldSearch && (
                  <p className="global-search-empty">
                    حداقل دو نویسه وارد کنید.
                  </p>
                )}
                {showLoadingMessage && (
                  <p className="global-search-empty">در حال جست‌وجو...</p>
                )}
                {error && <FormError className="mx-auto my-12 w-fit">{error}</FormError>}
                {shouldSearch && !isLoading && !error && !hasResults && (
                  <p className="global-search-empty">نتیجه‌ای پیدا نشد.</p>
                )}

                {results.poets.length > 0 && (
                  <SearchSection title="شاعران" icon={<FaUser />}>
                    {results.poets.map((poet) => {
                      const poetHref = getPoetHref(poet);
                      const resultContent = (
                        <>
                          <span>{poet.nickname || poet.name}</span>
                          {poet.nickname && <small>{poet.name}</small>}
                        </>
                      );

                      if (/^https?:\/\//.test(poetHref)) {
                        return (
                          <a
                            key={`${poet.id}-${poet.urlSlug}`}
                            href={poetHref}
                            className="global-search-result"
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={onClose}
                          >
                            {resultContent}
                          </a>
                        );
                      }

                      return (
                        <Link
                          key={`${poet.id}-${poet.urlSlug}`}
                          href={poetHref}
                          className="global-search-result"
                          onClick={onClose}
                        >
                          {resultContent}
                        </Link>
                      );
                    })}
                  </SearchSection>
                )}

                {results.books.length > 0 && (
                  <SearchSection title="دفترها و مجموعه‌ها" icon={<FaBookOpen />}>
                    {results.books.map((book) => (
                      <Link
                        key={book.key}
                        href={book.href}
                        className="global-search-result"
                        onClick={onClose}
                      >
                        <span>{book.title}</span>
                        <small>{book.poetName}</small>
                      </Link>
                    ))}
                  </SearchSection>
                )}

                {results.poems.length > 0 && (
                  <SearchSection title="شعرها" icon={<FaFeatherAlt />}>
                    {results.poems.map((poem) => (
                      <Link
                        key={`${"fullUrl" in poem ? "g" : "l"}-${poem.id}-${poem.poetSlug}`}
                        href={getPoemHref(poem)}
                        className="global-search-result"
                        onClick={onClose}
                      >
                        <span>{poem.title}</span>
                        <small>
                          {poem.poetName}
                          {"collection" in poem && poem.collection
                            ? `، ${poem.collection}`
                            : ""}
                        </small>
                        <p>{getResultExcerpt(poem, normalizedQuery)}</p>
                      </Link>
                    ))}
                  </SearchSection>
                )}

                {shouldSearch && (
                  <Link
                    href={`/search?q=${encodeURIComponent(query.trim())}`}
                    className="global-search-all-results"
                    onClick={onClose}
                  >
                    مشاهده همه نتایج
                  </Link>
                )}
              </div>
      </DialogPopup>
    </Dialog>
  );
};

function SearchSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="global-search-section">
      <h3>
        {icon}
        <span>{title}</span>
      </h3>
      <div>{children}</div>
    </section>
  );
}

export default GlobalSearchDialog;
