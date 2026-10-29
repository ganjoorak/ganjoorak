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
import type { Poet } from "@/types/poet";
import { useSettings } from "@/context/SettingsContext";
import { logger } from "@/utils/logger";
import RandomizePoemsPrompt from "@/components/RandomizePoemsPrompt";
import { createPoemOrder, formatPersianNumber } from "@/components/poet-page/poetPageUtils";
import { usePoemSequence } from "@/components/poet-page/usePoemSequence";

const fetchEcholaliaPoem = (poemId: number) => echolaliaApi.getPoemById(poemId);

export default function EcholaliaPoetPage({ poetSlug }: { poetSlug: string }) {
  const { settings, setRandomizePoems, setAskRandomizePoemsOnPoetPages } =
    useSettings();
  const [randomizeChoice, setRandomizeChoice] = useState<boolean | null>(null);
  const shouldAskRandomizeChoice = settings.askRandomizePoemsOnPoetPages;
  const randomizePoems = randomizeChoice ?? settings.randomizePoems;

  const [poet, setPoet] = useState<Poet | null>(null);
  const [summaries, setSummaries] = useState<EcholaliaPoemSummary[]>([]);
  const [isInfoOpen, setIsInfoOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const skipNextPoemOrderEffectRef = useRef(false);

  const sequence = usePoemSequence(fetchEcholaliaPoem, {
    loadError: "متأسفانه در دریافت شعر از اکولالیا مشکلی پیش آمد.",
    label: "Echolalia",
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
  } = sequence;

  useEffect(() => {
    let cancelled = false;

    const loadPoet = async () => {
      setRandomizeChoice(null);
      setLoading(true);
      setError(null);
      setIsInfoOpen(true);
      setPoet(null);
      setSummaries([]);
      resetSequence();

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
  }, [poetSlug, reloadKey, resetSequence]);

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

    if (order.length === 0) {
      clearSequence();
      setPoemError("شعری برای این شاعر ثبت نشده است.");
      return;
    }

    play(order);
  }, [
    clearSequence,
    play,
    randomizeChoice,
    randomizePoems,
    setPoemError,
    shouldAskRandomizeChoice,
    summaries,
  ]);

  const { goNext, goPrevious } = sequence;
  const handleNext = useCallback(() => goNext(randomizePoems), [goNext, randomizePoems]);

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

  const handleRandomPoem = useCallback(() => {
    const order = createPoemOrder(
      summaries.map((summary) => summary.id),
      true,
    );
    if (!order.length) return;
    skipNextPoemOrderEffectRef.current = randomizeChoice !== true;
    setRandomizeChoice(true);
    setIsInfoOpen(false);
    play(order);
  }, [play, randomizeChoice, summaries]);

  const handleSelectSummary = useCallback(
    (poemId: number) => {
      const order = summaries.map((summary) => summary.id);
      const index = order.indexOf(poemId);
      if (index < 0) return;

      skipNextPoemOrderEffectRef.current = true;
      setRandomizeChoice(false);
      setIsInfoOpen(false);
      play(order, index);
    },
    [play, summaries],
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
  const isLastPoem = !randomizePoems && sequence.isAtEnd;
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
          {!poemError && currentPoem && (
            <PoemFeedPager
              poem={currentPoem}
              nextPoem={nextPoem}
              onNext={handleNext}
              onPrevious={goPrevious}
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
