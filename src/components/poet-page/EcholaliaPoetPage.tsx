"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PoemFeedPager from "@/components/PoemFeedPager";
import LoadingScreen from "@/components/LoadingScreen";
import ErrorScreen from "@/components/ErrorScreen";
import AppNotFound from "@/app/not-found";
import PoetProfile, { PoetProfileList, PoetProfileSection } from "@/components/PoetProfile";
import { buildPoetKey } from "@/hooks/usePreferredPoet";
import PoetSearchPanel from "@/components/PoetSearchPanel";
import echolaliaApi, { type EcholaliaPoemSummary } from "@/api/EcholaliaApi";
import type { Poem } from "@/types/poem";
import type { Poet } from "@/types/poet";
import { useSettings } from "@/context/SettingsContext";
import { logger } from "@/utils/logger";
import RandomizePoemsPrompt from "@/components/RandomizePoemsPrompt";
import { createPoemOrder, formatPersianNumber } from "@/components/poet-page/poetPageUtils";

export default function EcholaliaPoetPage({ poetSlug }: { poetSlug: string }) {
  const { settings, setRandomizePoems, setAskRandomizePoemsOnPoetPages } =
    useSettings();
  const [randomizeChoice, setRandomizeChoice] = useState<boolean | null>(null);
  const shouldAskRandomizeChoice = settings.askRandomizePoemsOnPoetPages;
  const randomizePoems = randomizeChoice ?? settings.randomizePoems;

  const [poet, setPoet] = useState<Poet | null>(null);
  const [summaries, setSummaries] = useState<EcholaliaPoemSummary[]>([]);
  const [poemOrder, setPoemOrder] = useState<number[]>([]);
  const [currentPoemIndex, setCurrentPoemIndex] = useState(0);
  const [currentPoem, setCurrentPoem] = useState<Poem | null>(null);
  const [isInfoOpen, setIsInfoOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [poemError, setPoemError] = useState<string | null>(null);
  const [poemLoading, setPoemLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const poemCacheRef = useRef<Record<number, Poem>>({});
  const poemOrderRef = useRef<number[]>([]);
  const skipNextPoemOrderEffectRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const loadPoet = async () => {
      setRandomizeChoice(null);
      setLoading(true);
      setError(null);
      setPoemError(null);
      setIsInfoOpen(true);
      setPoet(null);
      setSummaries([]);
      setPoemOrder([]);
      setCurrentPoem(null);
      setCurrentPoemIndex(0);
      poemCacheRef.current = {};
      poemOrderRef.current = [];

      try {
        const [poetInfo, poemSummaries] = await Promise.all([
          echolaliaApi.getPoetBySlug(poetSlug),
          echolaliaApi.getPoemsByPoetSlug(poetSlug),
        ]);
        if (cancelled) return;
        setPoet(poetInfo);
        setSummaries(poemSummaries);
      } catch (err) {
        if (cancelled) return;
        logger.error("Error loading Echolalia poet:", err);
        setError("متأسفانه در دریافت اطلاعات شاعر از اکولالیا مشکلی پیش آمد.");
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
  }, [poetSlug, reloadKey]);

  const loadPoemById = useCallback(async (poemId: number) => {
    if (poemCacheRef.current[poemId]) {
      return poemCacheRef.current[poemId];
    }
    const poem = await echolaliaApi.getPoemById(poemId);
    poemCacheRef.current[poemId] = poem;
    return poem;
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
        const poem = await loadPoemById(order[index]);
        setCurrentPoem(poem);
        setCurrentPoemIndex(index);
      } catch (err) {
        logger.error("Error loading Echolalia poem:", err);
        setPoemError("متأسفانه در دریافت شعر از اکولالیا مشکلی پیش آمد.");
      } finally {
        setPoemLoading(false);
      }
    },
    [loadPoemById],
  );

  useEffect(() => {
    if (!currentPoem) return;
    const order = poemOrderRef.current;
    if (!order.length) return;

    [currentPoemIndex + 1, currentPoemIndex - 1].forEach((index) => {
      const poemId = order[index];
      if (!poemId || poemCacheRef.current[poemId]) return;
      loadPoemById(poemId).catch((error) => {
        logger.error("Error preloading Echolalia poem:", error);
      });
    });
  }, [currentPoem, currentPoemIndex, loadPoemById, poemOrder]);

  useEffect(() => {
    if (shouldAskRandomizeChoice && randomizeChoice === null) {
      return;
    }
    if (skipNextPoemOrderEffectRef.current) {
      skipNextPoemOrderEffectRef.current = false;
      return;
    }
    const order = createPoemOrder(
      summaries.map((poem) => poem.id),
      randomizePoems,
    );
    poemOrderRef.current = order;
    setPoemOrder(order);

    if (order.length === 0) {
      setCurrentPoem(null);
      setPoemError("شعری برای این شاعر ثبت نشده است.");
      return;
    }

    loadPoemAtIndex(0, order);
  }, [
    loadPoemAtIndex,
    randomizeChoice,
    randomizePoems,
    shouldAskRandomizeChoice,
    summaries,
  ]);

  const handleNext = useCallback(() => {
    const order = poemOrderRef.current;
    const nextIndex = currentPoemIndex + 1;

    if (nextIndex < order.length) {
      loadPoemAtIndex(nextIndex);
      return;
    }

    if (randomizePoems && order.length > 0) {
      const reshuffled = createPoemOrder(order, true);
      poemOrderRef.current = reshuffled;
      setPoemOrder(reshuffled);
      loadPoemAtIndex(0, reshuffled);
    }
  }, [currentPoemIndex, loadPoemAtIndex, randomizePoems]);

  const handlePrevious = useCallback(() => {
    const previousIndex = currentPoemIndex - 1;
    if (previousIndex >= 0) {
      loadPoemAtIndex(previousIndex);
    }
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

  const handleRandomPoem = useCallback(() => {
    const order = createPoemOrder(
      summaries.map((summary) => summary.id),
      true,
    );
    if (!order.length) return;
    skipNextPoemOrderEffectRef.current = randomizeChoice !== true;
    setRandomizeChoice(true);
    poemOrderRef.current = order;
    setPoemOrder(order);
    setPoemError(null);
    setIsInfoOpen(false);
    loadPoemAtIndex(0, order);
  }, [loadPoemAtIndex, randomizeChoice, summaries]);

  const handleSelectSummary = useCallback(
    (poemId: number) => {
      const order = summaries.map((summary) => summary.id);
      const index = order.indexOf(poemId);
      if (index < 0) return;

      skipNextPoemOrderEffectRef.current = true;
      setRandomizeChoice(false);
      poemOrderRef.current = order;
      setPoemOrder(order);
      setPoemError(null);
      setIsInfoOpen(false);
      loadPoemAtIndex(index, order);
    },
    [loadPoemAtIndex, summaries],
  );

  if (loading) {
    return <LoadingScreen />;
  }

  if (error) {
    return (
      <ErrorScreen message={error} onRetry={() => setReloadKey((v) => v + 1)} />
    );
  }

  if (!poet) {
    return <AppNotFound />;
  }

  const isFirstPoem = currentPoemIndex <= 0;
  const isLastPoem =
    !randomizePoems &&
    (poemOrder.length === 0 || currentPoemIndex >= poemOrder.length - 1);
  const nextPoemId = poemOrder[currentPoemIndex + 1];
  const nextPoem = nextPoemId ? poemCacheRef.current[nextPoemId] : undefined;
  const showRandomizePrompt =
    !isInfoOpen && shouldAskRandomizeChoice && randomizeChoice === null;

  return (
    <div className="poet-page relative flex h-screen flex-col bg-neutral-950 text-neutral-100">
      {showRandomizePrompt && (
        <RandomizePoemsPrompt
          poetName={poet.nickname || poet.name}
          onChoose={handleRandomizeChoice}
        />
      )}
      <PoetProfile
        poet={poet}
        isOpen={isInfoOpen}
        poetKey={buildPoetKey("echolalia", poetSlug)}
        stats={[{ label: "شعر", value: formatPersianNumber(summaries.length) }]}
        onResume={currentPoem ? () => setIsInfoOpen(false) : undefined}
        onRandom={handleRandomPoem}
      >
        <PoetSearchPanel poet={poet} />
        <PoetProfileSection
          title="شعرها"
          aside={
            summaries.length > 0 ? (
              <span>{formatPersianNumber(summaries.length)} شعر</span>
            ) : undefined
          }
        >
          {summaries.length > 0 ? (
            <PoetProfileList
              rows={summaries.map((summary) => ({
                id: summary.id,
                title: summary.title,
                isSelected: currentPoem?.id === summary.id,
              }))}
              onSelect={handleSelectSummary}
            />
          ) : (
            <p className="poet-profile-empty">
              شعری برای این شاعر ثبت نشده است.
            </p>
          )}
        </PoetProfileSection>
      </PoetProfile>
      <main className="relative flex flex-1 flex-col overflow-hidden">
        <div className="relative flex flex-1 flex-col overflow-hidden">
          {poemLoading && !currentPoem && <LoadingScreen />}
          {poemError && (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
              <p className="text-sm text-neutral-300">{poemError}</p>
              {poemOrder.length > 0 && (
                <button
                  type="button"
                  onClick={() => loadPoemAtIndex(currentPoemIndex)}
                  className="rounded bg-neutral-700 px-4 py-2 text-sm text-neutral-50 hover:bg-neutral-600"
                >
                  تلاش مجدد
                </button>
              )}
            </div>
          )}
          {!poemError && currentPoem && (
            <PoemFeedPager
              poem={currentPoem}
              nextPoem={nextPoem}
              onNext={handleNext}
              onPrevious={handlePrevious}
              isFirst={isFirstPoem}
              isLast={isLastPoem}
              isPreparingNextPoem={poemLoading && !nextPoem && !isLastPoem}
              poetSlug={currentPoem.poetSlug}
              isPoetPage={true}
              onTogglePoetInfo={() => setIsInfoOpen(true)}
              onOpenFeed={() => setIsInfoOpen(true)}
              onOpenFeedLabel="شعرهای شاعر"
            />
          )}
        </div>
      </main>
    </div>
  );
}
