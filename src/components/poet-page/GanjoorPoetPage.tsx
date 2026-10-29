"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PoemFeedPager from "@/components/PoemFeedPager";
import LoadingScreen from "@/components/LoadingScreen";
import ErrorScreen from "@/components/ErrorScreen";
import AppNotFound from "@/app/not-found";
import PoetProfile, { PoetProfileList, PoetProfileSection } from "@/components/PoetProfile";
import { buildPoetKey } from "@/hooks/usePreferredPoet";
import { useLovedCollections } from "@/hooks/useLovedCollections";
import { buildCollectionKey } from "@/utils/collectionLibrary";
import PoetSearchPanel from "@/components/PoetSearchPanel";
import ganjoorApi from "@/api/GanjoorApi";
import type { Poem } from "@/types/poem";
import type { GanjoorCategory, GanjoorPoetCatalog } from "@/types/ganjoor";
import { useSettings } from "@/context/SettingsContext";
import { logger } from "@/utils/logger";
import { fetchRandomPoemByPoetId } from "@/utils/poemIndex";
import RandomizePoemsPrompt from "@/components/RandomizePoemsPrompt";
import { buildCategoryRows, createPoemOrder, formatPersianNumber, indexCategories } from "@/components/poet-page/poetPageUtils";

export default function GanjoorPoetPage({ slug, poetId }: { slug: string; poetId?: number }) {
  const { settings, setRandomizePoems, setAskRandomizePoemsOnPoetPages } =
    useSettings();
  const { isLoved, toggle: toggleLovedBook } = useLovedCollections();
  const [randomizeChoice, setRandomizeChoice] = useState<boolean | null>(null);
  const shouldAskRandomizeChoice = settings.askRandomizePoemsOnPoetPages;
  const randomizePoems = randomizeChoice ?? settings.randomizePoems;

  const [catalog, setCatalog] = useState<GanjoorPoetCatalog | null>(null);
  const [isInfoOpen, setIsInfoOpen] = useState(true);
  const [categoryCache, setCategoryCache] = useState<
    Record<number, GanjoorCategory>
  >({});
  const [loadedCategoryIds, setLoadedCategoryIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(
    null,
  );
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [categoryLoading, setCategoryLoading] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);

  const [poemOrder, setPoemOrder] = useState<number[]>([]);
  const [currentPoemIndex, setCurrentPoemIndex] = useState(0);
  const [currentPoem, setCurrentPoem] = useState<Poem | null>(null);
  const [poemError, setPoemError] = useState<string | null>(null);
  const [poemLoading, setPoemLoading] = useState(false);

  const poemCacheRef = useRef<Record<number, Poem>>({});
  const poemOrderRef = useRef<number[]>([]);
  const shouldAutoCloseInfoRef = useRef(false);
  const [isRandomMode, setIsRandomMode] = useState(false);
  const [isRandomLoading, setIsRandomLoading] = useState(false);
  const randomPrefetchRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const loadCatalog = async () => {
      setRandomizeChoice(null);
      setLoadingCatalog(true);
      setCatalogError(null);
      setNotFound(false);
      setCatalog(null);
      setIsInfoOpen(true);
      setIsRandomMode(false);
      setCategoryCache({});
      setLoadedCategoryIds(new Set());
      setSelectedCategoryId(null);
      setCategoryError(null);
      setPoemOrder([]);
      setCurrentPoem(null);
      setPoemError(null);
      setCurrentPoemIndex(0);
      poemCacheRef.current = {};
      poemOrderRef.current = [];

      try {
        const fetchedCatalog = await ganjoorApi.getPoetCatalog(slug, poetId);
        if (cancelled) return;
        setCatalog(fetchedCatalog);
        setCategoryCache(indexCategories(fetchedCatalog.category));
      } catch (error: any) {
        if (cancelled) return;
        logger.error("Error loading poet catalog:", error);
        if (
          error instanceof Error &&
          error.message &&
          /یافت نشد/.test(error.message)
        ) {
          setNotFound(true);
        } else {
          setCatalogError(
            "متأسفانه در دریافت اطلاعات شاعر مشکلی پیش آمد. لطفاً دوباره تلاش کنید.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingCatalog(false);
        }
      }
    };

    loadCatalog();

    return () => {
      cancelled = true;
    };
  }, [slug, poetId, reloadKey]);

  const cachedCategory = selectedCategoryId
    ? categoryCache[selectedCategoryId]
    : undefined;
  const selectedCategoryIsLoaded = selectedCategoryId
    ? loadedCategoryIds.has(selectedCategoryId)
    : false;

  const fetchPoemById = useCallback(async (poemId: number) => {
    if (poemCacheRef.current[poemId]) {
      return poemCacheRef.current[poemId];
    }
    const poemData = await ganjoorApi.getPoemById(poemId);
    poemCacheRef.current[poemId] = poemData;
    return poemData;
  }, []);

  const loadPoemAtIndex = useCallback(
    async (index: number, orderOverride?: number[]) => {
      const order = orderOverride ?? poemOrderRef.current;
      if (!order.length || index < 0 || index >= order.length) {
        return;
      }

      setPoemLoading(true);
      setPoemError(null);
      try {
        const poemId = order[index];
        const poemData = await fetchPoemById(poemId);
        setCurrentPoem(poemData);
        setCurrentPoemIndex(index);
      } catch (error) {
        logger.error("Error loading poem:", error);
        setPoemError(
          "متأسفانه در دریافت شعر مشکلی پیش آمد. لطفاً دوباره تلاش کنید.",
        );
      } finally {
        setPoemLoading(false);
      }
    },
    [fetchPoemById],
  );

  useEffect(() => {
    if (!currentPoem) return;
    const order = poemOrderRef.current;
    if (!order.length) return;

    [currentPoemIndex + 1, currentPoemIndex - 1].forEach((index) => {
      const poemId = order[index];
      if (!poemId || poemCacheRef.current[poemId]) return;
      fetchPoemById(poemId).catch((error) => {
        logger.error("Error preloading Ganjoor poem:", error);
      });
    });
  }, [currentPoem, currentPoemIndex, fetchPoemById, poemOrder]);

  useEffect(() => {
    if (!selectedCategoryId) return;
    let cancelled = false;

    const clearPoems = () => {
      poemOrderRef.current = [];
      setPoemOrder([]);
      setCurrentPoem(null);
      setCurrentPoemIndex(0);
      setPoemError(null);
    };

    const applyCategory = async (categoryData: GanjoorCategory) => {
      if ((categoryData.children?.length ?? 0) > 0) {
        clearPoems();
        return;
      }

      const poemIds = (categoryData.poems ?? []).map((poem) => poem.id);

      if (poemIds.length === 0) {
        poemOrderRef.current = [];
        setPoemOrder([]);
        setCurrentPoem(null);
        setCurrentPoemIndex(0);
        setPoemError("در این مجموعه شعری ثبت نشده است.");
        return;
      }

      if (shouldAskRandomizeChoice && randomizeChoice === null) {
        clearPoems();
        return;
      }

      const order = createPoemOrder(poemIds, randomizePoems);
      if (cancelled) return;

      poemOrderRef.current = order;
      setPoemOrder(order);

      await loadPoemAtIndex(0, order);
    };

    const hasCachedChildren = (cachedCategory?.children?.length ?? 0) > 0;
    const hasCachedPoems = (cachedCategory?.poems?.length ?? 0) > 0;
    const canUseCachedCategory =
      cachedCategory &&
      (hasCachedChildren || hasCachedPoems || selectedCategoryIsLoaded);

    if (canUseCachedCategory) {
      setCategoryLoading(false);
      setCategoryError(null);
      applyCategory(cachedCategory);
      return;
    }

    setCategoryLoading(true);
    setCategoryError(null);
    setPoemError(null);

    const fetchCategory = async () => {
      try {
        const fetched =
          await ganjoorApi.getCategoryWithPoems(selectedCategoryId);
        if (cancelled) return;
        const fetchedCategories = indexCategories(fetched);
        setCategoryCache((prev) => ({
          ...fetchedCategories,
          ...prev,
          [selectedCategoryId]: fetched,
        }));
        setLoadedCategoryIds((prev) => {
          const next = new Set(prev);
          next.add(selectedCategoryId);
          return next;
        });
        await applyCategory(fetched);
      } catch (error) {
        if (cancelled) return;
        logger.error("Error fetching category data:", error);
        setCategoryError(
          "متأسفانه در دریافت مجموعهٔ اشعار مشکلی پیش آمد. لطفاً دوباره تلاش کنید.",
        );
        setPoemOrder([]);
        poemOrderRef.current = [];
        setCurrentPoem(null);
        setCurrentPoemIndex(0);
      } finally {
        if (!cancelled) {
          setCategoryLoading(false);
        }
      }
    };

    fetchCategory();

    return () => {
      cancelled = true;
    };
  }, [
    selectedCategoryId,
    cachedCategory,
    selectedCategoryIsLoaded,
    randomizeChoice,
    randomizePoems,
    shouldAskRandomizeChoice,
    loadPoemAtIndex,
  ]);

  const handleSelectCategory = useCallback(
    (categoryId: number) => {
      if (categoryId === selectedCategoryId) {
        return;
      }

      const nextCategory = categoryCache[categoryId];
      const needsCategoryLoad =
        !nextCategory ||
        (((nextCategory.children?.length ?? 0) === 0 ||
          !nextCategory.children) &&
          ((nextCategory.poems?.length ?? 0) === 0 || !nextCategory.poems) &&
          !loadedCategoryIds.has(categoryId));

      setRandomizeChoice(null);
      setIsRandomMode(false);
      setCategoryLoading(needsCategoryLoad);
      setCategoryError(null);
      setPoemError(null);
      setPoemOrder([]);
      poemOrderRef.current = [];
      setCurrentPoem(null);
      setCurrentPoemIndex(0);
      shouldAutoCloseInfoRef.current = true;
      setSelectedCategoryId(categoryId);
    },
    [categoryCache, loadedCategoryIds, selectedCategoryId],
  );

  const handleRetryCatalog = () => setReloadKey((prev) => prev + 1);

  const handleRetryCategory = useCallback(() => {
    if (!selectedCategoryId) return;
    setCategoryCache((prev) => {
      const next = { ...prev };
      delete next[selectedCategoryId];
      return next;
    });
    setLoadedCategoryIds((prev) => {
      const next = new Set(prev);
      next.delete(selectedCategoryId);
      return next;
    });
    setCategoryError(null);
  }, [selectedCategoryId]);

  const handleRetryPoem = useCallback(() => {
    loadPoemAtIndex(currentPoemIndex);
  }, [currentPoemIndex, loadPoemAtIndex]);

  const handleRandomizeChoice = useCallback(
    (shouldRandomize: boolean, rememberChoice: boolean) => {
      setRandomizePoems(shouldRandomize);
      if (rememberChoice) {
        setAskRandomizePoemsOnPoetPages(false);
      }
      setRandomizeChoice(shouldRandomize);
      setPoemError(null);
    },
    [setAskRandomizePoemsOnPoetPages, setRandomizePoems],
  );

  const selectedCategory = cachedCategory ?? null;
  const selectedCategoryHasChildren =
    (selectedCategory?.children?.length ?? 0) > 0;

  useEffect(() => {
    if (!isInfoOpen) return;
    if (selectedCategoryId === null) return;
    if (categoryLoading) return;
    if (poemLoading) return;
    if (selectedCategoryHasChildren) return;
    if (!shouldAutoCloseInfoRef.current) return;
    shouldAutoCloseInfoRef.current = false;
    setIsInfoOpen(false);
  }, [
    isInfoOpen,
    selectedCategoryId,
    categoryLoading,
    poemLoading,
    selectedCategoryHasChildren,
  ]);

  const fetchRandomPoetPoem = useCallback(async () => {
    if (!catalog) {
      throw new Error("Poet catalog is not loaded");
    }
    const poem = await fetchRandomPoemByPoetId(catalog.poet.id);
    poemCacheRef.current[poem.id] = poem;
    return poem;
  }, [catalog]);

  const appendRandomPoem = useCallback(async () => {
    const poem = await fetchRandomPoetPoem();
    const order = poemOrderRef.current;
    if (order[order.length - 1] === poem.id) {
      return order;
    }
    const next = [...order, poem.id];
    poemOrderRef.current = next;
    setPoemOrder(next);
    return next;
  }, [fetchRandomPoetPoem]);

  // Random mode: keep one random poem queued so the pull-to-next sheet has
  // something to preview.
  useEffect(() => {
    if (!isRandomMode || !currentPoem) return;
    if (poemOrderRef.current[currentPoemIndex + 1]) return;
    if (randomPrefetchRef.current) return;
    randomPrefetchRef.current = true;
    appendRandomPoem()
      .catch((error) => logger.error("Error preloading random poem:", error))
      .finally(() => {
        randomPrefetchRef.current = false;
      });
  }, [appendRandomPoem, currentPoem, currentPoemIndex, isRandomMode]);

  const handleRandomPoem = useCallback(async () => {
    setIsRandomLoading(true);
    try {
      const poem = await fetchRandomPoetPoem();
      shouldAutoCloseInfoRef.current = false;
      poemOrderRef.current = [poem.id];
      setPoemOrder([poem.id]);
      setRandomizeChoice(true);
      setIsRandomMode(true);
      setSelectedCategoryId(null);
      setCategoryError(null);
      setPoemError(null);
      setCurrentPoem(poem);
      setCurrentPoemIndex(0);
      setIsInfoOpen(false);
    } catch (error) {
      logger.error("Error loading random poet poem:", error);
      setCategoryError("دریافت شعر تصادفی ممکن نشد. لطفاً دوباره تلاش کنید.");
    } finally {
      setIsRandomLoading(false);
    }
  }, [fetchRandomPoetPoem]);

  const handleNext = useCallback(() => {
    const order = poemOrderRef.current;
    if (!order.length) return;
    const nextIndex = currentPoemIndex + 1;

    if (nextIndex < order.length) {
      loadPoemAtIndex(nextIndex);
      return;
    }

    if (isRandomMode) {
      setPoemLoading(true);
      appendRandomPoem()
        .then((next) => loadPoemAtIndex(nextIndex, next))
        .catch((error) => {
          logger.error("Error loading random poem:", error);
          setPoemLoading(false);
        });
      return;
    }

    if (randomizePoems && order.length > 0) {
      const reshuffled = createPoemOrder(order, true);
      poemOrderRef.current = reshuffled;
      setPoemOrder(reshuffled);
      loadPoemAtIndex(0, reshuffled);
    }
  }, [
    appendRandomPoem,
    currentPoemIndex,
    isRandomMode,
    randomizePoems,
    loadPoemAtIndex,
  ]);

  const handlePrevious = useCallback(() => {
    const order = poemOrderRef.current;
    if (!order.length) return;
    const prevIndex = currentPoemIndex - 1;

    if (prevIndex >= 0) {
      loadPoemAtIndex(prevIndex);
    }
  }, [currentPoemIndex, loadPoemAtIndex]);

  const topLevelCategories = useMemo(() => {
    if (!catalog) return [];
    const root = categoryCache[catalog.category.id] ?? catalog.category;
    // Books are the root's children. A root that only holds poems (no
    // children) is itself the single readable collection.
    if ((root.children?.length ?? 0) > 0) {
      return root.children;
    }
    return (root.poems?.length ?? 0) > 0 ? [root] : [];
  }, [catalog, categoryCache]);

  const isFirstPoem = currentPoemIndex <= 0;
  const isLastPoem =
    !isRandomMode &&
    !randomizePoems &&
    (poemOrder.length === 0 || currentPoemIndex >= poemOrder.length - 1);
  const nextPoemId = poemOrder[currentPoemIndex + 1];
  const nextPoem = nextPoemId ? poemCacheRef.current[nextPoemId] : undefined;
  const showPoemLoadingOverlay = poemLoading && !currentPoem;
  const loadingCategoryId =
    selectedCategoryId !== null && (categoryLoading || poemLoading)
      ? selectedCategoryId
      : null;
  const containerClassName = [
    "poet-page",
    "relative flex h-screen flex-col bg-neutral-950 text-neutral-100",
  ].join(" ");

  if (loadingCatalog) {
    return <LoadingScreen />;
  }

  if (notFound) {
    return <AppNotFound />;
  }

  if (catalogError) {
    return <ErrorScreen message={catalogError} onRetry={handleRetryCatalog} />;
  }

  if (!catalog) {
    return null;
  }

  const showRandomizePrompt =
    !!selectedCategoryId &&
    !isInfoOpen &&
    shouldAskRandomizeChoice &&
    randomizeChoice === null;

  return (
    <div className={containerClassName}>
      {showRandomizePrompt && (
        <RandomizePoemsPrompt
          poetName={catalog.poet.nickname || catalog.poet.name}
          onChoose={handleRandomizeChoice}
        />
      )}
      <PoetProfile
        poet={catalog.poet}
        isOpen={isInfoOpen}
        poetKey={buildPoetKey("ganjoor", slug)}
        stats={[
          {
            label: "مجموعه",
            value: formatPersianNumber(topLevelCategories.length),
          },
        ]}
        onResume={currentPoem ? () => setIsInfoOpen(false) : undefined}
        onRandom={handleRandomPoem}
        isRandomLoading={isRandomLoading}
      >
        <PoetSearchPanel poet={catalog.poet} />
        <PoetProfileSection
          title="مجموعه‌ها"
          hint={
            selectedCategoryId === null &&
            !currentPoem &&
            topLevelCategories.length > 0
              ? "برای شروع خواندن، یک مجموعه را انتخاب کنید."
              : undefined
          }
        >
          {topLevelCategories.length > 0 ? (
            <PoetProfileList
              rows={buildCategoryRows(
                topLevelCategories,
                categoryCache,
                selectedCategoryId,
                loadingCategoryId,
              ).map((row) => ({
                ...row,
                isLoved: isLoved(buildCollectionKey("ganjoor", slug, row.id)),
              }))}
              onSelect={handleSelectCategory}
              onToggleLove={(categoryId) => {
                const category = topLevelCategories.find((item) => item.id === categoryId);
                if (!category) return;
                toggleLovedBook({
                  key: buildCollectionKey("ganjoor", slug, categoryId),
                  source: "ganjoor",
                  categoryId,
                  poetSlug: slug,
                  poetName: catalog.poet.nickname || catalog.poet.name,
                  title: category.title,
                  href: `/${slug}`,
                });
              }}
            />
          ) : (
            <p className="poet-profile-empty">
              مجموعه‌ای برای این شاعر ثبت نشده است.
            </p>
          )}
          {categoryError && (
            <div className="poet-profile-error" role="alert">
              <p>{categoryError}</p>
              {selectedCategoryId !== null && (
                <button type="button" onClick={handleRetryCategory}>
                  تلاش مجدد
                </button>
              )}
            </div>
          )}
        </PoetProfileSection>
      </PoetProfile>
      <main
        className="relative flex flex-1 flex-col overflow-hidden"
      >
        <div className="relative flex flex-1 flex-col overflow-hidden">
          {showPoemLoadingOverlay && <LoadingScreen />}

          {!showPoemLoadingOverlay && poemError && (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
              <p className="text-sm text-neutral-300">{poemError}</p>
              {poemOrder.length > 0 && (
                <button
                  type="button"
                  onClick={handleRetryPoem}
                  className="rounded bg-neutral-700 px-4 py-2 text-sm text-neutral-50 hover:bg-neutral-600"
                >
                  تلاش مجدد
                </button>
              )}
            </div>
          )}

          {!showPoemLoadingOverlay && !poemError && currentPoem && (
            <PoemFeedPager
              poem={currentPoem}
              nextPoem={nextPoem}
              onNext={handleNext}
              onPrevious={handlePrevious}
              isFirst={isFirstPoem}
              isLast={isLastPoem}
              isPreparingNextPoem={poemLoading && !nextPoem && !isLastPoem}
              poetSlug={catalog.poet.urlSlug}
              isPoetPage={true}
              onTogglePoetInfo={() => {
                shouldAutoCloseInfoRef.current = false;
                setIsInfoOpen(true);
              }}
              onOpenFeed={() => {
                shouldAutoCloseInfoRef.current = false;
                setIsInfoOpen(true);
              }}
              onOpenFeedLabel="مجموعه‌های شاعر"
            />
          )}

          {!showPoemLoadingOverlay && !poemError && !currentPoem && (
            categoryLoading ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 bg-black px-6 text-center text-neutral-400">
                <p className="text-sm text-neutral-300">در حال بارگذاری مجموعه...</p>
                <p className="text-xs text-neutral-500">
                  شعرهای این بخش تا چند لحظه دیگر نمایش داده می‌شوند.
                </p>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center bg-black px-6 text-center text-neutral-400">
                <button
                  type="button"
                  onClick={() => {
                    shouldAutoCloseInfoRef.current = false;
                    setIsInfoOpen(true);
                  }}
                  className="rounded-lg px-4 py-3 text-sm leading-7 text-neutral-300 transition hover:bg-neutral-900 hover:text-neutral-100"
                >
                  برای شروع، یک مجموعه را از صفحهٔ شاعر انتخاب کنید.
                </button>
              </div>
            )
          )}
        </div>
      </main>
    </div>
  );
}
