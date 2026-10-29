"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PoemFeedPager from "@/components/PoemFeedPager";
import LoadingScreen from "@/components/LoadingScreen";
import ErrorScreen from "@/components/ErrorScreen";
import PoetProfile, { PoetProfileList, PoetProfileSection } from "@/components/PoetProfile";
import { buildPoetKey } from "@/hooks/usePreferredPoet";
import { useLovedCollections } from "@/hooks/useLovedCollections";
import { buildCollectionKey } from "@/utils/collectionLibrary";
import PoetSearchPanel from "@/components/PoetSearchPanel";
import customApi from "@/api/CustomApi";
import type { Poet } from "@/types/poet";
import { PoetSlug } from "@/types/poet";
import { useSettings } from "@/context/SettingsContext";
import { logger } from "@/utils/logger";
import RandomizePoemsPrompt from "@/components/RandomizePoemsPrompt";
import { usePoemSequence } from "@/components/poet-page/usePoemSequence";
import { type LocalPoemSummary, createPoemOrder, formatPersianNumber, groupByCollection } from "@/components/poet-page/poetPageUtils";

export default function CustomPoetPage({ poetSlug }: { poetSlug: PoetSlug }) {
  const { settings, setRandomizePoems, setAskRandomizePoemsOnPoetPages } =
    useSettings();
  const { isLoved, toggle: toggleLovedBook } = useLovedCollections();
  const [randomizeChoice, setRandomizeChoice] = useState<boolean | null>(null);
  const shouldAskRandomizeChoice = settings.askRandomizePoemsOnPoetPages;
  const randomizePoems = randomizeChoice ?? settings.randomizePoems;

  const [poetInfo, setPoetInfo] = useState<Poet | null>(null);
  const [isInfoOpen, setIsInfoOpen] = useState(true);
  const [poemIds, setPoemIds] = useState<number[]>([]);
  const [poemSummaries, setPoemSummaries] = useState<LocalPoemSummary[]>([]);
  const [collectionMeta, setCollectionMeta] = useState<Array<{ title: string; year?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const poemMapRef = useRef<Record<number, any>>({});
  const skipNextPoemOrderEffectRef = useRef(false);

  const fetchCustomPoem = useCallback(
    async (poemId: number) => {
      const localPoem = poemMapRef.current[poemId];
      if (!localPoem) {
        throw new Error("شعر یافت نشد");
      }
      return customApi.mapLocalPoemToPoem(localPoem, poetSlug);
    },
    [poetSlug],
  );
  const sequence = usePoemSequence(fetchCustomPoem, {
    loadError: "متأسفانه در دریافت شعر مشکلی پیش آمد.",
    label: "custom",
  });
  const {
    index: currentPoemIndex,
    poem: currentPoem,
    loading: poemLoading,
    error: poemError,
    setError: setPoemError,
    nextPoem,
    reset: resetSequence,
    clear: clearSequence,
    play,
    goPrevious,
  } = sequence;

  useEffect(() => {
    let cancelled = false;

    const loadPoet = async () => {
      setRandomizeChoice(null);
      setLoading(true);
      setError(null);
      setIsInfoOpen(true);
      setPoemIds([]);
      setPoemSummaries([]);
      resetSequence();
      poemMapRef.current = {};

      try {
        const [info, dataset] = await Promise.all([
          customApi.getPoetInfo(poetSlug),
          customApi._getPoetData(poetSlug),
        ]);
        if (cancelled) return;

        setPoetInfo(info);

        if (!dataset || !Array.isArray(dataset.poems)) {
          setError("مجموعهٔ شعرهای این شاعر در دسترس نیست.");
          return;
        }

        const ids: number[] = [];
        const summaries: LocalPoemSummary[] = [];
        const map: Record<number, any> = {};
        dataset.poems.forEach((poem: any) => {
          if (poem?.id) {
            map[poem.id] = poem;
            ids.push(poem.id);
            summaries.push({
              id: poem.id,
              title: poem.title || `شعر ${formatPersianNumber(poem.id)}`,
              collection:
                typeof poem.collection === "string" && poem.collection.trim()
                  ? poem.collection.trim()
                  : undefined,
            });
          }
        });

        poemMapRef.current = map;
        setPoemIds(ids);
        setPoemSummaries(summaries);
        setCollectionMeta(Array.isArray(dataset.collections) ? dataset.collections : []);
      } catch (err) {
        if (cancelled) return;
        logger.error("Error loading custom poet:", err);
        setError("متأسفانه در دریافت اطلاعات شاعر مشکلی پیش آمد.");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadPoet();

    return () => {
      cancelled = true;
    };
  }, [poetSlug, reloadKey, resetSequence]);

  useEffect(() => {
    if (shouldAskRandomizeChoice && randomizeChoice === null) {
      return;
    }
    if (skipNextPoemOrderEffectRef.current) {
      skipNextPoemOrderEffectRef.current = false;
      return;
    }
    if (!poemIds.length) {
      clearSequence();
      return;
    }

    play(createPoemOrder(poemIds, randomizePoems));
  }, [
    clearSequence,
    play,
    poemIds,
    randomizeChoice,
    randomizePoems,
    shouldAskRandomizeChoice,
  ]);

  const { goNext } = sequence;
  const handleNext = useCallback(() => goNext(randomizePoems), [goNext, randomizePoems]);

  const handleRetryPoet = () => setReloadKey((prev) => prev + 1);

  const handleRandomPoem = useCallback(() => {
    const order = createPoemOrder(poemIds, true);
    if (!order.length) return;
    skipNextPoemOrderEffectRef.current = randomizeChoice !== true;
    setRandomizeChoice(true);
    setIsInfoOpen(false);
    play(order);
  }, [play, poemIds, randomizeChoice]);

  const collectionGroups = useMemo(
    () =>
      poemSummaries.some((summary) => summary.collection)
        ? groupByCollection(poemSummaries, collectionMeta)
        : [],
    [collectionMeta, poemSummaries],
  );
  const collectionCount = collectionGroups.filter((group) => group.title).length;

  const handleSelectLocalSummary = useCallback(
    (poemId: number) => {
      const order = poemSummaries.map((summary) => summary.id);
      const index = order.indexOf(poemId);
      if (index < 0) return;

      skipNextPoemOrderEffectRef.current = true;
      setIsInfoOpen(false);
      setRandomizeChoice(false);
      play(order, index);
    },
    [play, poemSummaries],
  );

  // Like a Ganjoor book: opening a collection reads its poems in order.
  const handleSelectCollection = useCallback(
    (groupIndex: number) => {
      const group = collectionGroups[groupIndex];
      if (!group) return;
      const order = group.poems.map((summary) => summary.id);

      skipNextPoemOrderEffectRef.current = true;
      setIsInfoOpen(false);
      setRandomizeChoice(false);
      play(order);
    },
    [collectionGroups, play],
  );

  const handleRandomizeChoice = useCallback(
    (shouldRandomize: boolean, rememberChoice: boolean) => {
      setRandomizePoems(shouldRandomize);
      if (rememberChoice) {
        setAskRandomizePoemsOnPoetPages(false);
      }
      setRandomizeChoice(shouldRandomize);
      setPoemError(null);
    },
    [setAskRandomizePoemsOnPoetPages, setPoemError, setRandomizePoems],
  );

  const isFirstPoem = currentPoemIndex <= 0;
  const isLastPoem = !randomizePoems && sequence.isAtEnd;
  const showPoemLoadingOverlay = poemLoading && !currentPoem;
  const containerClassName = [
    "poet-page",
    "relative flex h-screen flex-col bg-neutral-950 text-neutral-100",
  ].join(" ");

  if (loading) {
    return <LoadingScreen />;
  }

  if (error) {
    return <ErrorScreen message={error} onRetry={handleRetryPoet} />;
  }

  if (!poetInfo) {
    return null;
  }

  const showRandomizePrompt =
    !isInfoOpen && shouldAskRandomizeChoice && randomizeChoice === null;

  return (
    <div className={containerClassName}>
      {showRandomizePrompt && (
        <RandomizePoemsPrompt
          poetName={poetInfo.nickname || poetInfo.name}
          onChoose={handleRandomizeChoice}
        />
      )}
      <PoetProfile
        poet={poetInfo}
        isOpen={isInfoOpen}
        poetKey={buildPoetKey("custom", poetSlug)}
        stats={[
          ...(collectionCount > 0
            ? [{ label: "مجموعه", value: formatPersianNumber(collectionCount) }]
            : []),
          { label: "شعر", value: formatPersianNumber(poemIds.length) },
        ]}
        onResume={currentPoem ? () => setIsInfoOpen(false) : undefined}
        onRandom={handleRandomPoem}
      >
        <PoetSearchPanel poet={poetInfo} />
        {collectionGroups.length > 0 ? (
          <PoetProfileSection
            title="مجموعه‌ها"
            hint={
              !currentPoem ? "برای شروع خواندن، یک مجموعه را انتخاب کنید." : undefined
            }
          >
            <PoetProfileList
              rows={collectionGroups.map((group, index) => ({
                id: index,
                title: group.title || "شعرهای دیگر",
                subtitle: group.year ?? undefined,
                count: group.poems.length,
                isSelected: Boolean(
                  currentPoem && group.poems.some((summary) => summary.id === currentPoem.id),
                ),
                // The untitled leftovers group is not a book.
                isLoved: group.title
                  ? isLoved(buildCollectionKey("custom", poetSlug, group.title))
                  : undefined,
              }))}
              onSelect={handleSelectCollection}
              onToggleLove={(groupIndex) => {
                const title = collectionGroups[groupIndex]?.title;
                if (!title || !poetInfo) return;
                toggleLovedBook({
                  key: buildCollectionKey("custom", poetSlug, title),
                  source: "custom",
                  categoryId: 0,
                  poetSlug,
                  poetName: poetInfo.nickname || poetInfo.name,
                  title,
                  href: `/${poetSlug}`,
                });
              }}
            />
          </PoetProfileSection>
        ) : (
          <PoetProfileSection
            title="شعرها"
            aside={
              poemSummaries.length > 0 ? (
                <span>{formatPersianNumber(poemSummaries.length)} شعر</span>
              ) : undefined
            }
          >
            {poemSummaries.length > 0 ? (
              <PoetProfileList
                rows={poemSummaries.map((summary, index) => ({
                  id: summary.id,
                  title: summary.title,
                  subtitle: summary.collection,
                  badge: formatPersianNumber(index + 1),
                  isSelected: currentPoem?.id === summary.id,
                }))}
                onSelect={handleSelectLocalSummary}
              />
            ) : (
              <p className="poet-profile-empty">
                شعری برای این شاعر ثبت نشده است.
              </p>
            )}
          </PoetProfileSection>
        )}
      </PoetProfile>
      <main className="relative flex flex-1 flex-col overflow-hidden">
        <div className="relative flex flex-1 flex-col overflow-hidden">
          {showPoemLoadingOverlay && <LoadingScreen />}

          {!showPoemLoadingOverlay && poemError && (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
              <p className="text-sm text-neutral-300">{poemError}</p>
              {sequence.order.length > 0 && (
                <button
                  type="button"
                  onClick={sequence.retry}
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
              onPrevious={goPrevious}
              isFirst={isFirstPoem}
              isLast={isLastPoem}
              isPreparingNextPoem={poemLoading && !nextPoem && !isLastPoem}
              poetSlug={poetSlug}
              isPoetPage={true}
              onTogglePoetInfo={() => setIsInfoOpen(true)}
              onOpenFeed={() => setIsInfoOpen(true)}
              onOpenFeedLabel="اطلاعات شاعر"
            />
          )}

          {!showPoemLoadingOverlay && !poemError && !currentPoem && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-neutral-400">
              <p className="text-sm">هیچ شعری برای نمایش وجود ندارد.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
