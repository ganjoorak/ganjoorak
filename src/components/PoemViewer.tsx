"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FaChevronUp, FaChevronDown } from "react-icons/fa";
import "../styles/PoemViewer.css";
import type { Poem } from "@/types/poem";
import Menu, { MenuButton, SearchButton } from "@/components/Menu";
import SettingsDialog from "@/components/SettingsDialog";
import GlobalSearchDialog from "@/components/GlobalSearchDialog";
import SharePoemDialog from "@/components/SharePoemDialog";
import MobileAudioControl from "@/components/MobileAudioControl";
import PullNextSheet from "@/components/PullNextSheet";
import AudioPlayerBar from "@/components/poem-viewer/AudioPlayerBar";
import PoemActionButtons from "@/components/poem-viewer/PoemActionButtons";
import PoemBody from "@/components/poem-viewer/PoemBody";
import { useEdgeNavigation } from "@/components/poem-viewer/useEdgeNavigation";
import { usePinnedEyebrow } from "@/components/poem-viewer/usePinnedEyebrow";
import { useRecitationPlayer } from "@/components/poem-viewer/useRecitationPlayer";
import { useStackedMesras } from "@/components/poem-viewer/useStackedMesras";
import { useVerseSync } from "@/components/poem-viewer/useVerseSync";
import { useHideOnScroll } from "@/hooks/useHideOnScroll";
import { usePullToNext } from "@/hooks/usePullToNext";
import { useSettings } from "@/context/SettingsContext";
import { useUpdateNotification } from "@/hooks/useUpdateNotification";
import { usePoemLibrary } from "@/hooks/usePoemLibrary";

interface PoemViewerProps {
  poem: Poem;
  onNext: (poem?: Poem) => void;
  onPrevious?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
  isModern?: boolean;
  poetSlug?: string;
  showNext?: boolean;
  isPoetPage?: boolean;
  onTogglePoetInfo?: () => void;
  onOpenFeed?: () => void;
  onOpenFeedLabel?: string;
  /** Small chip rendered in-flow above the poem title (e.g. the daily-poem link). */
  titleEyebrow?: React.ReactNode;
  /** Direction of the last navigation when a parent drives it (the feed pager); overrides the viewer's own. */
  navigationDirection?: "next" | "previous" | null;
  /** Feed "stay on this poem" lock; surfaced in the mobile menu. */
  isZenLocked?: boolean;
  onToggleZenLock?: () => void;
  /** Poem shown in the pull-to-next sheet while it slides up. */
  nextPoemPeek?: Poem | null;
  isPreparingNext?: boolean;
  /** Pull-to-next at the bottom of the poem. Defaults to on whenever there is a next poem (!isLast). */
  pullToNext?: boolean;
}

type FrameCustom = { instant: boolean; direction: number };

// Same pace and curve as a pull released by mouse (usePullToNext MOUSE_COMMIT_*), so every navigation moves alike.
const FRAME_SLIDE = { duration: 0.42, ease: [0.32, 0.72, 0, 1] as const };

// Like scrolling: the whole strip moves. Forward, the old poem rises out of the top as the new one rises in
// from below; back, the reverse. Both frames move together (AnimatePresence mode="popLayout").
const navigationFrameVariants = {
  enter: ({ direction }: FrameCustom) => ({ y: direction >= 0 ? "100%" : "-100%" }),
  center: { y: 0, transition: FRAME_SLIDE },
  exit: ({ instant, direction }: FrameCustom) =>
    instant
      ? { opacity: 1, transition: { duration: 0 } }
      : { y: direction >= 0 ? "-100%" : "100%", transition: FRAME_SLIDE },
};

const classNames = (...names: Array<string | false>) => names.filter(Boolean).join(" ");

const PoemViewer: React.FC<PoemViewerProps> = ({
  poem,
  onNext,
  onPrevious = () => {},
  isFirst = true,
  isLast = true,
  isModern = true,
  poetSlug,
  showNext = false,
  isPoetPage = false,
  onTogglePoetInfo,
  onOpenFeed,
  onOpenFeedLabel,
  titleEyebrow,
  navigationDirection: parentDirection = null,
  isZenLocked,
  onToggleZenLock,
  nextPoemPeek,
  isPreparingNext = false,
  pullToNext,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [navigationDirection, setNavigationDirection] = useState(0);
  // Set when a pull-to-next commits: the poem with this id (or "*" for an unknown target) lands without any
  // entrance/exit animation, because the pull sheet already shows it exactly where it will be.
  const [instantArrivalFor, setInstantArrivalFor] = useState<string | null>(null);
  const [isHighlightEnabled, setIsHighlightEnabled] = useState(true);
  /** The reading bar is expanded into the list of reciters. */
  const [isRecitersOpen, setIsRecitersOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const poemTextRef = useRef<HTMLDivElement | null>(null);
  // During a poem change the new poem mounts before the old one leaves (AnimatePresence popLayout); a plain ref
  // would be cleared when the old one unmounts, leaving scroll, pull-to-next and keys without a scroller.
  const attachPoemText = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    poemTextRef.current = element;
    return () => {
      if (poemTextRef.current === element) poemTextRef.current = null;
    };
  }, []);
  const { settings } = useSettings();
  const poemViewerVisibility = settings.poemViewerVisibility;
  const showTitleSection = poemViewerVisibility.titleSection;
  const { hasNewUpdates, markAsRead } = useUpdateNotification();
  const { isFavorite, toggleFavorite } = usePoemLibrary(poem);
  const player = useRecitationPlayer(poem);
  const { hasVerseSync, currentHighlightedVerse } = useVerseSync(
    poem,
    player.currentRecitationIndex,
    player.currentTime,
    player.isPlaying,
  );

  // A new poem starts at its top, with the title shown.
  useEffect(() => {
    containerRef.current
      ?.querySelector(".poem-content")
      ?.classList.remove("poem-content--title-hidden");
    if (poemTextRef.current) {
      poemTextRef.current.scrollTop = 0;
    }
  }, [poem.id, poem.recitations]);

  const { stop: stopPlayback } = player;
  const handleNext = useCallback((target?: Poem) => {
    setNavigationDirection(1);
    setInstantArrivalFor(null);
    stopPlayback();
    onNext(target);
  }, [stopPlayback, onNext]);

  const handlePrevious = useCallback(() => {
    setNavigationDirection(-1);
    setInstantArrivalFor(null);
    stopPlayback();
    onPrevious();
  }, [stopPlayback, onPrevious]);

  useEdgeNavigation({
    scrollRef: poemTextRef,
    rootRef: containerRef,
    poemId: poem.id,
    isFirst,
    disabled: isShareOpen,
    onPrevious: handlePrevious,
  });

  // A new poem starts with the list closed.
  useEffect(() => {
    setIsRecitersOpen(false);
  }, [poem.id]);

  useHideOnScroll(poemTextRef, poem.id);

  const hasTitleEyebrow = showTitleSection && Boolean(titleEyebrow);
  const { poemContentRef, eyebrowLayerRef, attachEyebrowSpacer } = usePinnedEyebrow(
    containerRef,
    titleEyebrow,
    showTitleSection,
  );
  const isStacked = useStackedMesras(poemTextRef, poem.id);

  const pullSheetRef = useRef<HTMLDivElement>(null);
  // Once a pull commits, the sheet keeps showing the poem it committed to while it fades out, even though
  // the page has already computed a new "next" for the poem that just landed.
  const [committedPeek, setCommittedPeek] = useState<Poem | null>(null);
  useEffect(() => {
    if (!committedPeek) return;
    const timer = window.setTimeout(() => setCommittedPeek(null), committedPeek.id === poem.id ? 400 : 7000);
    return () => window.clearTimeout(timer);
  }, [committedPeek, poem.id]);
  const isInstantArrival =
    instantArrivalFor !== null &&
    (instantArrivalFor === "*" || instantArrivalFor === String(poem.id));
  useEffect(() => {
    if (instantArrivalFor === null) return;
    // Once landed (or if the navigation never happened), later navigations animate normally again.
    const timer = window.setTimeout(
      () => setInstantArrivalFor(null),
      isInstantArrival && instantArrivalFor !== "*" ? 400 : 1500,
    );
    return () => window.clearTimeout(timer);
  }, [instantArrivalFor, isInstantArrival]);
  const sheetPoem = committedPeek ?? nextPoemPeek ?? null;
  const { commitNext } = usePullToNext({
    scrollRef: poemTextRef,
    rootRef: containerRef,
    sheetRef: pullSheetRef,
    // The open reciters list owns the wheel and the bottom of the screen: no pull while it is open.
    enabled: (pullToNext ?? !isLast) && !isZenLocked && !isShareOpen && !isRecitersOpen,
    // While the next poem is still loading the sheet springs back instead of navigating somewhere unseen.
    hasNext: Boolean(nextPoemPeek) || !isPreparingNext,
    // Navigate to exactly the poem the sheet showed (single source of truth for "next").
    onCommit: () => {
      if (nextPoemPeek) setCommittedPeek(nextPoemPeek);
      handleNext(nextPoemPeek ?? undefined);
      // After handleNext (which clears it): batched with the navigation, so the landing render already sees it.
      setInstantArrivalFor(nextPoemPeek ? String(nextPoemPeek.id) : "*");
    },
    resetKey: poem.id,
  });

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isShareOpen) {
        return;
      }

      if (!poemTextRef.current) return;

      // Handle audio controls
      if (poem.recitations && poem.recitations.length > 0) {
        if (
          e.code === "Space" &&
          !(e.target as Element)?.matches("input, textarea")
        ) {
          e.preventDefault();
          player.toggleAudio();
        } else if (
          e.code === "ArrowLeft" &&
          e.altKey &&
          poem.recitations.length > 1
        ) {
          player.handlePreviousRecitation();
        } else if (
          e.code === "ArrowRight" &&
          e.altKey &&
          poem.recitations.length > 1
        ) {
          player.handleNextRecitation();
        }
      }

      // Arrow keys move between poems
      if (e.code === "ArrowDown" && !isLast) {
        e.preventDefault();
        handleNext();
      } else if (e.code === "ArrowUp" && !isFirst) {
        e.preventDefault();
        handlePrevious();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    poem.recitations,
    player.currentRecitationIndex,
    player.isPlaying,
    isFirst,
    isLast,
    handleNext,
    handlePrevious,
    isShareOpen,
  ]);

  const hasRecitations = (poem.recitations?.length ?? 0) > 0;
  const isMinimalPoemView =
    !showTitleSection &&
    !poemViewerVisibility.actionButtons &&
    !hasRecitations;
  const highlightActive =
    isHighlightEnabled && hasVerseSync && currentHighlightedVerse !== -1;
  const poemContentClassName = classNames(
    "poem-content",
    !showTitleSection && "poem-content--centered",
    isMinimalPoemView && "poem-content--minimal",
    hasTitleEyebrow && "poem-content--has-eyebrow",
  );
  const poemTextClassName = classNames(
    "poem-text",
    highlightActive && "highlight-on",
    !hasRecitations && "poem-text--no-audio",
    isMinimalPoemView && "poem-text--minimal",
    showTitleSection && "poem-text--title-in-flow",
    isStacked && "poem-text--stacked",
  );

  const canNavigatePrevious = !isFirst;
  const canNavigateNext = showNext || !isLast;
  const showNavigationControls =
    poemViewerVisibility.navigationControls &&
    (canNavigatePrevious || canNavigateNext);
  const frameDirection = parentDirection ? (parentDirection === "next" ? 1 : -1) : navigationDirection;
  const frameCustom: FrameCustom = { instant: isInstantArrival, direction: frameDirection };

  const numberedClass = (modern: boolean) =>
    settings.showLineNumbers && modern ? " verse-line-numbered" : "";
  // verseOrder from the API is 1-based, rendered line indices are 0-based.
  const liveVerseClass = (lineIndex: number) =>
    `verse-line${numberedClass(isModern)}${
      isHighlightEnabled && hasVerseSync && currentHighlightedVerse === lineIndex + 1
        ? " verse-highlighted"
        : ""
    }`;
  // The page only says whether its own poem is modern; a next poem from the same source is alike.
  const sheetIsModern = sheetPoem
    ? sheetPoem.id === poem.id || sheetPoem.source === poem.source
      ? isModern
      : sheetPoem.source !== "ganjoor"
    : isModern;
  const toggleHighlight = () => setIsHighlightEnabled((v) => !v);

  if (!poem) return null;

  return (
    <motion.div
      className={classNames("poem-viewer", isPoetPage && "poem-viewer--embedded")}
      ref={containerRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <MenuButton
        onClick={() => setIsMenuOpen(!isMenuOpen)}
        hasNotification={hasNewUpdates}
      />
      <SearchButton onClick={() => setIsSearchOpen(true)} />
      <Menu
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        hasNewUpdates={hasNewUpdates}
        onUpdatesViewed={markAsRead}
        onOpenFeed={onOpenFeed}
        onOpenFeedLabel={onOpenFeedLabel}
        onOpenSettings={() => {
          setIsSettingsOpen(true);
          setIsMenuOpen(false);
        }}
        poemActions={{
          poetName: poem.poet && poem.poetSlug ? poem.poet : undefined,
          poetImageUrl: poem.poetImageUrl,
          poetHref:
            isPoetPage && onTogglePoetInfo ? undefined : `/${poem.poetSlug}`,
          onPoetClick:
            isPoetPage && onTogglePoetInfo ? onTogglePoetInfo : undefined,
          onShare: () => setIsShareOpen(true),
          onOpenSearch: () => setIsSearchOpen(true),
          isZenLocked,
          onToggleZenLock,
        }}
      />
      <SettingsDialog
        isOpen={isSettingsOpen}
        onClose={() => {
          setIsSettingsOpen(false);
        }}
      />
      <GlobalSearchDialog
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
      />
      <SharePoemDialog
        poem={poem}
        isOpen={isShareOpen}
        onClose={() => setIsShareOpen(false)}
        poetSlug={poetSlug}
      />

      {showNavigationControls && (
        <div className="navigation-controls" aria-label="ناوبری شعر">
          <button
            type="button"
            className="nav-button"
            onClick={handlePrevious}
            disabled={!canNavigatePrevious}
            aria-label="شعر قبلی"
            title="شعر قبلی"
          >
            <FaChevronUp aria-hidden="true" />
          </button>
          <button
            type="button"
            className="nav-button"
            // Like a pull: the next poem slides up with the current one; plain transition if it isn't ready.
            onClick={() => {
              if (!commitNext()) handleNext();
            }}
            disabled={!canNavigateNext}
            aria-label="شعر بعدی"
            title="شعر بعدی"
          >
            <FaChevronDown aria-hidden="true" />
          </button>
        </div>
      )}

      {hasRecitations && (
        <AudioPlayerBar
          poem={poem}
          player={player}
          isHighlightEnabled={isHighlightEnabled}
          onToggleHighlight={toggleHighlight}
          isRecitersOpen={isRecitersOpen}
          onRecitersOpenChange={setIsRecitersOpen}
        />
      )}

      {hasRecitations && (
        <MobileAudioControl
          isPlaying={player.isPlaying}
          isLoading={player.isAudioLoading}
          canPlay={Boolean(player.currentAudioSrc)}
          currentTime={player.currentTime}
          duration={player.duration}
          hasPrevious={player.hasPreviousRecitation}
          hasNext={player.hasNextRecitation}
          isHighlightEnabled={isHighlightEnabled}
          onToggle={player.toggleAudio}
          onPrevious={player.handlePreviousRecitation}
          onNext={player.handleNextRecitation}
          onToggleHighlight={toggleHighlight}
          onSeek={player.handleSeek}
          recitations={poem.recitations ?? []}
          currentRecitationIndex={player.currentRecitationIndex}
          onSelectRecitation={player.selectRecitation}
          poemTitle={poem.title}
        />
      )}

      {/* Poem content */}
      <div className={poemContentClassName} ref={poemContentRef}>
        {hasTitleEyebrow && (
          <div className="poem-eyebrow-layer" ref={eyebrowLayerRef}>
            <div className="poem-eyebrow">{titleEyebrow}</div>
          </div>
        )}
        <AnimatePresence mode="popLayout" initial={false} custom={frameCustom}>
          <motion.div
            key={poem.id}
            className="poem-navigation-frame"
            custom={frameCustom}
            variants={navigationFrameVariants}
            // A poem that arrives through the pull sheet is already on screen (the sheet was its exact copy):
            // no entrance, no exit, no fade, so the swap is invisible.
            initial={isInstantArrival ? false : "enter"}
            animate="center"
            exit="exit"
          >
            <div
              key={poem.id}
              className={poemTextClassName}
              ref={attachPoemText}
              data-poem-id={String(poem.id)}
            >
              {/* Entrance only for the first poem; navigated-to poems arrive already drawn, as when scrolling. */}
              <PoemBody
                poem={poem}
                isModern={isModern}
                animate={!isInstantArrival && frameDirection === 0}
                verseClass={liveVerseClass}
                isPoetPage={isPoetPage}
                hasEyebrow={hasTitleEyebrow}
                eyebrowSpacerRef={attachEyebrowSpacer}
              />
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {poemViewerVisibility.actionButtons && (
        <PoemActionButtons
          poem={poem}
          isFavorite={isFavorite}
          onToggleFavorite={toggleFavorite}
          isPoetPage={isPoetPage}
          onTogglePoetInfo={onTogglePoetInfo}
          onShare={() => setIsShareOpen(true)}
        />
      )}
      {(pullToNext ?? !isLast) && (
        <PullNextSheet
          ref={pullSheetRef}
          isPreparing={isPreparingNext}
          contentClassName={poemContentClassName}
          textClassName={poemTextClassName.replace(" highlight-on", "")}
        >
          {sheetPoem ? (
            // The sheet drops live-only state such as audio highlighting.
            <PoemBody
              poem={sheetPoem}
              isModern={sheetIsModern}
              animate={false}
              verseClass={() => `verse-line${numberedClass(sheetIsModern)}`}
              isPoetPage={isPoetPage}
              hasEyebrow={hasTitleEyebrow}
            />
          ) : null}
        </PullNextSheet>
      )}
    </motion.div>
  );
};

export default PoemViewer;
