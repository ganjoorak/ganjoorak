"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { FaFeatherAlt, FaHeadphones, FaRedoAlt } from "react-icons/fa";
import AppPage from "@/components/AppPage";
import PoetImage from "@/components/PoetImage";
import { Button } from "@/components/ui/button";
import ganjoorApi from "@/api/GanjoorApi";
import poetSourceIndex from "@/data/poet-source-index.json";
import type { Poem } from "@/types/poem";
import {
  getDirectoryPoetDisplayName,
  getPoetDirectory,
  loadPoetDirectory,
  subscribePoetDirectory,
  type DirectoryPoet,
} from "@/utils/poetDirectory";
import { logger } from "@/utils/logger";
import { getIndexedPoetImageUrl } from "@/utils/poetImages";
import "../styles/Explore.css";

type ExploreItem =
  | { kind: "poem"; key: string; poem: Poem; lines: string[]; isProse: boolean }
  | { kind: "poet"; key: string; poet: DirectoryPoet; isTall: boolean };

type GridEntry = { kind: "item"; item: ExploreItem } | { kind: "skeleton"; key: string; height: number };

const PAGE_SIZE = 12;
const FETCH_CONCURRENCY = 4;
/** A poet card follows every this-many poem cards. */
const POEMS_PER_POET = 3;
const SKELETON_HEIGHTS = [180, 240, 150, 280, 200, 160];
const PREVIEW_HOVER_DELAY_MS = 250;

const centuryBySlug = poetSourceIndex.sourcesBySlug as Record<
  string,
  { centuryName?: string | null } | undefined
>;

const persianNumber = new Intl.NumberFormat("fa-IR");

const shuffle = <T,>(items: T[]): T[] => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

/** Pinned poets (Hafez, Saadi...) mixed into the first screens, the rest after. */
const buildPoetQueue = () => {
  const withImages = getPoetDirectory().filter((poet) => poet.imageUrl);
  const pinned = withImages.filter((poet) => poet.pinOrder > 0);
  const others = shuffle(withImages.filter((poet) => poet.pinOrder <= 0));
  return [...shuffle([...pinned, ...others.slice(0, 20)]), ...others.slice(20)];
};

/**
 * One to four couplets, picked from the poem id so a card keeps its shape
 * across re-renders; prose shows its opening paragraph (clamped in CSS).
 */
const toPoemItem = (poem: Poem): ExploreItem => {
  const lines = poem.plainText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const isProse = poem.lineKinds?.[0] === "prose";
  const coupletCount = 1 + (poem.id % 4);
  return {
    kind: "poem",
    key: `poem-${poem.id}`,
    poem,
    lines: isProse ? lines.slice(0, 1) : lines.slice(0, coupletCount * 2),
    isProse,
  };
};

const toPoetItem = (poet: DirectoryPoet): ExploreItem => ({
  kind: "poet",
  key: `poet-${poet.key}`,
  poet,
  isTall: poet.id % 3 === 0,
});

/** Rough rendered height, only used to pick the shortest column. */
const estimateHeight = (item: ExploreItem) => {
  if (item.kind === "poet") {
    return item.isTall ? 300 : 230;
  }
  return 70 + (item.isProse ? 150 : item.lines.length * 30);
};

const columnsForWidth = (width: number) => {
  if (width < 600) return 2;
  if (width < 860) return 3;
  if (width < 1120) return 4;
  if (width < 1400) return 5;
  return 6;
};

function useColumnCount(ref: React.RefObject<HTMLElement | null>) {
  const [columns, setColumns] = useState(2);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setColumns(columnsForWidth(element.clientWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return columns;
}

/**
 * Places entries in order into the currently shortest column, so appending a
 * page never moves cards that are already on screen and reading order runs
 * row by row from the right.
 */
const distribute = (entries: GridEntry[], columnCount: number) => {
  const columns: GridEntry[][] = Array.from({ length: columnCount }, () => []);
  const heights = new Array<number>(columnCount).fill(0);

  entries.forEach((entry) => {
    let target = 0;
    for (let i = 1; i < columnCount; i += 1) {
      if (heights[i] < heights[target]) target = i;
    }
    columns[target].push(entry);
    heights[target] += entry.kind === "item" ? estimateHeight(entry.item) : entry.height;
  });

  return columns;
};

type PreviewState = { poemId: number; status: "loading" | "playing" } | null;

/**
 * One shared audio element for hover previews, so only a single recitation
 * plays at a time. Buffering begins on pointer enter; sound waits for a short
 * hover so sweeping the pointer across the grid stays silent.
 */
function useRecitationPreview() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const tokenRef = useRef(0);
  const [preview, setPreview] = useState<PreviewState>(null);

  const stop = useCallback(() => {
    tokenRef.current += 1;
    window.clearTimeout(timerRef.current);
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setPreview(null);
  }, []);

  const start = useCallback(
    (poemId: number, url: string) => {
      stop();
      const token = tokenRef.current;
      const audio = (audioRef.current ??= new Audio());
      audio.preload = "auto";
      audio.onplaying = () => {
        if (token === tokenRef.current) setPreview({ poemId, status: "playing" });
      };
      audio.onended = () => {
        if (token === tokenRef.current) setPreview(null);
      };
      // Buffer during the hover delay so sound starts as soon as it's allowed to.
      audio.src = url;
      audio.load();
      timerRef.current = window.setTimeout(() => {
        if (audio.paused) setPreview({ poemId, status: "loading" });
        audio.play().catch((error: unknown) => {
          // Browsers refuse audio until the page has had a click or key press.
          if (token !== tokenRef.current) return;
          logger.warn("Recitation preview did not start:", error);
          setPreview(null);
        });
      }, PREVIEW_HOVER_DELAY_MS);
    },
    [stop],
  );

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) stop();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stop();
    };
  }, [stop]);

  return { preview, start, stop };
}

function PoemCard({
  item,
  previewStatus,
  onPreviewStart,
  onPreviewStop,
}: {
  item: Extract<ExploreItem, { kind: "poem" }>;
  previewStatus: "loading" | "playing" | null;
  onPreviewStart: (poemId: number, url: string) => void;
  onPreviewStop: () => void;
}) {
  const { poem, lines, isProse } = item;
  const poetImageUrl = getIndexedPoetImageUrl("ganjoor", poem.poetSlug) ?? poem.poetImageUrl;
  const recitationCount = poem.recitations?.length ?? 0;
  const previewUrl = poem.recitations?.find((recitation) => recitation.mp3Url)?.mp3Url;

  return (
    <Link
      href={`/poem/${poem.id}`}
      prefetch={false}
      className={[
        "explore-card explore-poem",
        previewStatus ? `is-preview-${previewStatus}` : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse" && previewUrl) {
          onPreviewStart(poem.id, previewUrl);
        }
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse" && previewUrl) onPreviewStop();
      }}
      onClick={onPreviewStop}
    >
      {recitationCount > 0 && (
        <span className="explore-badge" title="خوانش صوتی">
          {previewStatus ? (
            <span className="explore-eq" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          ) : (
            <FaHeadphones aria-hidden="true" />
          )}
          {persianNumber.format(recitationCount)}
          <span className="sr-only">خوانش</span>
        </span>
      )}
      <div className={`explore-poem-text${isProse ? " is-prose" : ""}`}>
        {lines.map((line, index) => (
          <p key={index}>{line}</p>
        ))}
      </div>
      <div className="explore-poem-foot">
        <span className="explore-avatar" aria-hidden="true">
          <PoetImage imgUrl={poetImageUrl} width={56} height={56} />
        </span>
        <span className="explore-poem-meta">
          <span className="explore-poem-poet">{poem.poet}</span>
          <span className="explore-poem-title">{poem.title}</span>
        </span>
      </div>
    </Link>
  );
}

function PoetCard({
  item,
  name,
}: {
  item: Extract<ExploreItem, { kind: "poet" }>;
  name: string;
}) {
  const { poet, isTall } = item;
  const caption =
    centuryBySlug[poet.urlSlug]?.centuryName ||
    (poet.source === "ganjoor" ? "شاعر کلاسیک" : "شاعر معاصر");

  return (
    <Link
      href={`/${poet.urlSlug}`}
      prefetch={false}
      className={`explore-card explore-poet${isTall ? " is-tall" : ""}`}
    >
      <Image
        src={poet.imageUrl || "/images/default-poet.png"}
        alt=""
        fill
        sizes="(max-width: 600px) 50vw, (max-width: 1120px) 25vw, 16vw"
        className="explore-poet-image"
      />
      <span className="explore-badge">
        <FaFeatherAlt aria-hidden="true" />
        شاعر
      </span>
      <span className="explore-poet-meta">
        <span className="explore-poet-name">{name}</span>
        <span className="explore-poet-caption">{caption}</span>
      </span>
    </Link>
  );
}

export default function ExplorePage() {
  const gridRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const columnCount = useColumnCount(gridRef);
  const { preview, start: startPreview, stop: stopPreview } = useRecitationPreview();
  const [items, setItems] = useState<ExploreItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);
  const [isNearEnd, setIsNearEnd] = useState(true);
  const [directory, setDirectory] = useState(getPoetDirectory);

  const loadingRef = useRef(false);
  const generationRef = useRef(0);
  const seenPoemIdsRef = useRef(new Set<number>());
  const poemCountRef = useRef(0);
  const poetQueueRef = useRef<DirectoryPoet[] | null>(null);

  useEffect(() => {
    const unsubscribe = subscribePoetDirectory(() => setDirectory(getPoetDirectory()));
    void loadPoetDirectory();
    return unsubscribe;
  }, []);

  const displayNames = useMemo(
    () => new Map(directory.map((poet) => [poet.key, getDirectoryPoetDisplayName(poet)])),
    [directory],
  );

  const appendPoem = useCallback((poem: Poem) => {
    if (seenPoemIdsRef.current.has(poem.id)) return;
    seenPoemIdsRef.current.add(poem.id);
    poemCountRef.current += 1;

    const next: ExploreItem[] = [toPoemItem(poem)];
    if (poemCountRef.current % POEMS_PER_POET === 0) {
      if (!poetQueueRef.current?.length) {
        poetQueueRef.current = buildPoetQueue();
      }
      const poet = poetQueueRef.current.shift();
      if (poet) next.push(toPoetItem(poet));
    }
    setItems((previous) => [...previous, ...next]);
  }, []);

  const loadPage = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    const generation = generationRef.current;
    setIsLoading(true);
    setHasFailed(false);

    let remaining = PAGE_SIZE;
    let loaded = 0;
    const worker = async () => {
      while (remaining > 0 && generation === generationRef.current) {
        remaining -= 1;
        try {
          const random = await ganjoorApi.getRandomPoem();
          // The random endpoint leaves out recitations; the full poem has them.
          const poem = await ganjoorApi.getPoemById(random.id);
          if (generation !== generationRef.current) return;
          appendPoem(poem);
          loaded += 1;
        } catch (error) {
          logger.error("Failed to load explore poem:", error);
        }
      }
    };

    await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));

    if (generation === generationRef.current) {
      loadingRef.current = false;
      setIsLoading(false);
      setHasFailed(loaded === 0);
    }
  }, [appendPoem]);

  const reshuffle = useCallback(() => {
    generationRef.current += 1;
    loadingRef.current = false;
    stopPreview();
    seenPoemIdsRef.current = new Set();
    poemCountRef.current = 0;
    poetQueueRef.current = null;
    setItems([]);
    setHasFailed(false);
    window.scrollTo({ top: 0 });
    void loadPage();
  }, [loadPage, stopPreview]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsNearEnd(entry.isIntersecting),
      { rootMargin: "0px 0px 1200px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // Keeps loading pages while the end of the grid is within reach.
  useEffect(() => {
    if (isNearEnd && !isLoading && !hasFailed) {
      void loadPage();
    }
  }, [hasFailed, isLoading, isNearEnd, loadPage]);

  const columns = useMemo(() => {
    const entries: GridEntry[] = items.map((item) => ({ kind: "item", item }));
    if (isLoading) {
      const skeletonCount = Math.max(columnCount * 2, 4);
      for (let i = 0; i < skeletonCount; i += 1) {
        entries.push({
          kind: "skeleton",
          key: `skeleton-${i}`,
          height: SKELETON_HEIGHTS[i % SKELETON_HEIGHTS.length],
        });
      }
    }
    return distribute(entries, columnCount);
  }, [columnCount, isLoading, items]);

  return (
    <AppPage
      title="کاوش"
      subtitle="شعرها و شاعرانی برای گشت‌وگذار؛ هر بار مجموعه‌ای تازه."
      width="wide"
      className="explore-page"
      actions={
        <Button
          variant="ghost"
          size="icon-lg"
          className="app-page-bar-icon"
          onClick={reshuffle}
          aria-label="مجموعهٔ تازه"
          title="مجموعهٔ تازه"
        >
          <FaRedoAlt />
        </Button>
      }
    >
      <div ref={gridRef} className="explore-grid" aria-busy={isLoading}>
        {columns.map((column, columnIndex) => (
          <div key={columnIndex} className="explore-column">
            {column.map((entry) => {
              if (entry.kind === "skeleton") {
                return (
                  <div
                    key={entry.key}
                    className="explore-card explore-skeleton"
                    style={{ height: entry.height }}
                    aria-hidden="true"
                  />
                );
              }
              const { item } = entry;
              return item.kind === "poem" ? (
                <PoemCard
                  key={item.key}
                  item={item}
                  previewStatus={preview?.poemId === item.poem.id ? preview.status : null}
                  onPreviewStart={startPreview}
                  onPreviewStop={stopPreview}
                />
              ) : (
                <PoetCard
                  key={item.key}
                  item={item}
                  name={displayNames.get(item.poet.key) ?? getDirectoryPoetDisplayName(item.poet)}
                />
              );
            })}
          </div>
        ))}
      </div>

      {hasFailed && (
        <div className="explore-status" role="status">
          <p>
            {items.length === 0
              ? "شعرها بارگیری نشدند. اتصال را بررسی کنید و دوباره تلاش کنید."
              : "بارگیری شعرهای بیشتر ممکن نشد."}
          </p>
          <Button variant="outline" onClick={() => void loadPage()}>
            تلاش دوباره
          </Button>
        </div>
      )}

      <div ref={sentinelRef} className="explore-sentinel" aria-hidden="true" />
    </AppPage>
  );
}
