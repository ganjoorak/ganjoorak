"use client";

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useReducedMotion,
} from "framer-motion";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Film,
  Image as ImageIcon,
  Link2,
  RotateCcw,
  Share2,
  X,
} from "lucide-react";
import type { Poem } from "@/types/poem";
import { logger } from "@/utils/logger";
import { Button } from "@/components/ui/button";
import { Dialog, DialogPopup, DialogTitle } from "@/components/ui/dialog";
import {
  FONT_STACKS,
  useSettings,
  type FontFamilyOption,
} from "@/context/SettingsContext";
import {
  SHARE_CARD_THEMES,
  canvasToBlob,
  ensureShareFonts,
  layoutShareCard,
  paintShareCard,
  renderShareCardCanvas,
  type ShareCardFormat,
  type ShareCardInput,
  type ShareCardLayout,
  type ShareCardLayoutResult,
  type ShareCardThemeId,
} from "@/components/share/shareCard";
import {
  drawShareFrame,
  pickShareVideoMime,
} from "@/components/share/shareVideo";
import {
  PREVIEW_SCALE,
  buildPoemUrl,
  readPrefs,
  saveBlob,
  writePrefs,
  type ActionId,
  type Feedback,
  type ShareMode,
  type Step,
} from "@/components/share/shareDialog";
import { fade, stepTransition, stepVariants } from "@/components/share/shareMotion";
import { useShareVideo } from "@/components/share/useShareVideo";
import { useIsPhone } from "@/components/share/useIsPhone";
import { OptionTabs } from "@/components/share/OptionTabs";
import VersePicker from "@/components/share/VersePicker";
import SharePreview from "@/components/share/SharePreview";
import ShareDesignBar from "@/components/share/ShareDesignBar";
import "@/styles/SharePoemDialog.css";

interface SharePoemDialogProps {
  poem: Poem;
  isOpen: boolean;
  onClose: () => void;
  poetSlug?: string;
  /** Line indices (into the poem's non-empty lines) to start with; default is the first four. */
  initialSelected?: number[];
}


const SharePoemDialog: React.FC<SharePoemDialogProps> = ({
  poem,
  isOpen,
  onClose,
  poetSlug,
  initialSelected,
}) => {
  const { settings } = useSettings();
  const isPhone = useIsPhone();
  const reduceMotion = useReducedMotion();

  const [selected, setSelected] = useState<number[]>([]);
  const [step, setStep] = useState<Step>("select");
  const [direction, setDirection] = useState(1);
  const [mode, setMode] = useState<ShareMode>("image");
  const [themeId, setThemeId] = useState<ShareCardThemeId>("dark");
  const [format, setFormat] = useState<ShareCardFormat>("post");
  const [cardLayout, setCardLayout] = useState<ShareCardLayout>("single");
  const [fontFamily, setFontFamily] = useState<FontFamilyOption>(settings.fontFamily);
  const [recitationIndex, setRecitationIndex] = useState(-1);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [layout, setLayout] = useState<ShareCardLayoutResult | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(true);
  const [panel, setPanel] = useState<"type" | "voice" | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [support, setSupport] = useState({ shareFiles: false, share: false, video: false });

  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const imageBlobRef = useRef<Blob | null>(null);
  const prefsLoaded = useRef(false);

  const poemUrl = useMemo(() => buildPoemUrl(poem, poetSlug), [poem, poetSlug]);
  const lines = useMemo(
    () =>
      poem.plainText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    [poem.plainText],
  );
  const recitations = useMemo(
    () => (poem.recitations ?? []).filter((r) => r.mp3Url).slice(0, 4),
    [poem.recitations],
  );
  const recitation = recitationIndex >= 0 ? recitations[recitationIndex] : undefined;

  const selectedLines = useMemo(
    () =>
      selected
        .filter((index) => lines[index])
        .map((index) => ({ index, text: lines[index] })),
    [lines, selected],
  );
  const theme =
    SHARE_CARD_THEMES.find((item) => item.id === themeId) ?? SHARE_CARD_THEMES[0];
  const fontStack = FONT_STACKS[fontFamily];

  const cardInput: ShareCardInput = useMemo(
    () => ({
      title: poem.title,
      poet: poem.poet,
      lines: selectedLines,
      theme,
      fontStack,
      layout: cardLayout,
      format,
    }),
    [cardLayout, fontStack, format, poem.poet, poem.title, selectedLines, theme],
  );

  const shareText = useMemo(
    () =>
      [
        selectedLines.map((line) => line.text).join("\n"),
        "",
        `${poem.title} - ${poem.poet}`,
        poemUrl,
      ]
        .filter(Boolean)
        .join("\n"),
    [poem.poet, poem.title, poemUrl, selectedLines],
  );

  const { video, previewTimeline, generateVideo, cancelVideo, resetVideo, busy, progress } =
    useShareVideo({
      isOpen,
      layout,
      cardInput,
      fontStack,
      recitation,
      recitationIndex,
      selectedLines,
    });

  // Feature detection runs on the client only.
  useEffect(() => {
    const probe = new File([new Blob(["x"], { type: "image/png" })], "x.png", {
      type: "image/png",
    });
    setSupport({
      share: typeof navigator.share === "function",
      shareFiles:
        typeof navigator.canShare === "function" && navigator.canShare({ files: [probe] }),
      video: pickShareVideoMime() !== null,
    });
  }, []);

  // Reset per opening; restore the last look the reader chose.
  useEffect(() => {
    if (!isOpen) return;
    const prefs = readPrefs();
    const appTheme = settings.theme as ShareCardThemeId;
    setThemeId(prefs.theme ?? appTheme ?? "dark");
    setFormat(prefs.format ?? "post");
    setCardLayout(prefs.layout ?? "single");
    setFontFamily(prefs.font ?? settings.fontFamily);
    prefsLoaded.current = true;
    setSelected(
      initialSelected?.length
        ? initialSelected.filter((index) => index >= 0 && index < lines.length)
        : lines.slice(0, 4).map((_, index) => index),
    );
    setStep("select");
    setDirection(1);
    setMode("image");
    setRecitationIndex(-1);
    setPanel(null);
    setFeedback(null);
    resetVideo();
    // Only on open / poem change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, poem.id]);

  useEffect(() => {
    if (!isOpen || !prefsLoaded.current) return;
    writePrefs({ theme: themeId, format, layout: cardLayout, font: fontFamily });
  }, [cardLayout, fontFamily, format, isOpen, themeId]);

  useEffect(() => {
    if (!panel) return;
    const close = (event: PointerEvent) => {
      if (!barRef.current?.contains(event.target as Node)) setPanel(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [panel]);

  useEffect(() => {
    if (mode !== "video" && panel === "voice") setPanel(null);
  }, [mode, panel]);

  useEffect(() => {
    if (!feedback) return;
    const id = window.setTimeout(() => setFeedback(null), 1600);
    return () => window.clearTimeout(id);
  }, [feedback]);

  // Lay out the card whenever its inputs change (after the font is ready),
  // and render the full-size PNG in the background so Share can run
  // straight from the click (Safari drops the gesture across awaits).
  useEffect(() => {
    if (!isOpen || selectedLines.length === 0) {
      setLayout(null);
      imageBlobRef.current = null;
      return;
    }
    let cancelled = false;
    const run = async () => {
      await ensureShareFonts(cardInput.fontStack);
      if (cancelled) return;
      const measure = document.createElement("canvas").getContext("2d");
      if (!measure) return;
      setLayout(layoutShareCard(measure, cardInput));
      imageBlobRef.current = null;
      try {
        const { canvas } = await renderShareCardCanvas(cardInput);
        const blob = await canvasToBlob(canvas);
        if (!cancelled) imageBlobRef.current = blob;
      } catch (error) {
        logger.error("Error creating share image:", error);
      }
    };
    const id = window.setTimeout(run, 60);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [cardInput, isOpen, selectedLines.length]);

  // Paint the preview. Image mode is a still; video mode loops the animation.
  const showVideoResult = mode === "video" && video.status === "done";
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !layout || showVideoResult) return;
    canvas.width = Math.round(layout.width * PREVIEW_SCALE);
    canvas.height = Math.round(layout.height * PREVIEW_SCALE);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(PREVIEW_SCALE, 0, 0, PREVIEW_SCALE, 0, 0);

    if (mode === "image" || !previewTimeline) {
      paintShareCard(ctx, layout);
      return;
    }
    const playing = previewPlaying && !reduceMotion;
    if (!playing) {
      drawShareFrame(ctx, layout, previewTimeline, previewTimeline.duration);
      return;
    }
    let frame = 0;
    const loop = previewTimeline.duration + 0.8;
    const start = performance.now();
    const tick = () => {
      const t = ((performance.now() - start) / 1000) % loop;
      drawShareFrame(ctx, layout, previewTimeline, Math.min(t, previewTimeline.duration));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [layout, mode, previewPlaying, previewTimeline, reduceMotion, showVideoResult, step, isPhone]);

  const toggleLine = (index: number) =>
    setSelected((prev) =>
      prev.includes(index)
        ? prev.filter((item) => item !== index)
        : [...prev, index].sort((a, b) => a - b),
    );

  const goTo = (next: Step) => {
    setDirection(next === "design" ? 1 : -1);
    setStep(next);
  };

  const flash = (action: ActionId, ok: boolean) => setFeedback({ action, ok });

  const copy = async (action: "copyText" | "copyLink", text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      flash(action, true);
    } catch (error) {
      logger.error("Failed to copy:", error);
      flash(action, false);
    }
  };

  const fileBase = `ganjoorak-${poem.id}`;

  const currentFile = (): File | null => {
    if (mode === "video") {
      if (video.status !== "done") return null;
      const { blob, extension } = video.result;
      return new File([blob], `${fileBase}.${extension}`, { type: blob.type });
    }
    const blob = imageBlobRef.current;
    return blob ? new File([blob], `${fileBase}.png`, { type: "image/png" }) : null;
  };

  const download = async () => {
    try {
      const file = currentFile();
      if (file) {
        saveBlob(file, file.name);
      } else if (mode === "image") {
        const { canvas } = await renderShareCardCanvas(cardInput);
        saveBlob(await canvasToBlob(canvas), `${fileBase}.png`);
      } else {
        return;
      }
      flash("download", true);
    } catch (error) {
      logger.error("Download failed:", error);
      flash("download", false);
    }
  };

  const share = async () => {
    const file = currentFile();
    const data: ShareData =
      file && support.shareFiles && navigator.canShare({ files: [file] })
        ? { files: [file], title: poem.title, text: `${poem.title} - ${poem.poet}\n${poemUrl}` }
        : { title: poem.title, text: shareText };
    try {
      await navigator.share(data);
      flash("share", true);
    } catch (error) {
      if ((error as DOMException)?.name !== "AbortError") {
        logger.error("Share failed:", error);
        flash("share", false);
      }
    }
  };

  const feedbackIcon = (action: ActionId, icon: React.ReactNode) => (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span key={feedback?.action === action ? (feedback.ok ? "ok" : "err") : "icon"} className="share-action__icon" {...fade}>
        {feedback?.action === action ? feedback.ok ? <Check /> : <X /> : icon}
      </motion.span>
    </AnimatePresence>
  );

  const versePicker = (
    <VersePicker
      lines={lines}
      selected={selected}
      onToggleLine={toggleLine}
      onSelectedChange={setSelected}
    />
  );

  const designer = (
    <section className="share-pane share-pane--design" aria-label="پیش‌نمایش و طراحی">
      <OptionTabs<ShareMode>
        label="نوع خروجی"
        value={mode}
        onChange={(next) => {
          setMode(next);
          // Video is mostly for stories.
          if (next === "video" && format === "post") setFormat("story");
        }}
        options={[
          {
            value: "image",
            label: (
              <>
                <ImageIcon aria-hidden="true" /> تصویر
              </>
            ),
          },
          {
            value: "video",
            disabled: !support.video,
            title: support.video ? undefined : "این مرورگر ضبط ویدیو را پشتیبانی نمی‌کند",
            label: (
              <>
                <Film aria-hidden="true" /> ویدیو
              </>
            ),
          },
        ]}
      />

      <SharePreview
        mode={mode}
        format={format}
        video={video}
        showVideoResult={showVideoResult}
        previewRef={previewRef}
        layout={layout}
        hasSelectedLines={selectedLines.length > 0}
        previewPlaying={previewPlaying}
        reduceMotion={reduceMotion}
        onTogglePreview={() => setPreviewPlaying((p) => !p)}
        busy={busy}
        progress={progress}
        onCancel={cancelVideo}
      />

      <ShareDesignBar
        mode={mode}
        panel={panel}
        onPanelChange={setPanel}
        barRef={barRef}
        themeId={themeId}
        onThemeChange={setThemeId}
        format={format}
        onFormatChange={setFormat}
        cardLayout={cardLayout}
        onCardLayoutChange={setCardLayout}
        fontFamily={fontFamily}
        onFontFamilyChange={setFontFamily}
        fontStack={fontStack}
        recitations={recitations}
        recitationIndex={recitationIndex}
        onRecitationIndexChange={setRecitationIndex}
      />
    </section>
  );

  const videoReady = video.status === "done";
  const hasAsset = mode === "image" ? Boolean(layout) : videoReady;
  const canShare = support.share;

  const primaryAction =
    mode === "video" && !videoReady ? (
      <Button
        className="share-action share-action--primary"
        onClick={busy ? cancelVideo : generateVideo}
        disabled={!layout}
      >
        {busy ? <X /> : <Film />}
        <span>{busy ? "لغو ساخت" : "ساخت ویدیو"}</span>
      </Button>
    ) : canShare ? (
      <Button
        className="share-action share-action--primary"
        onClick={share}
        disabled={!hasAsset}
      >
        {feedbackIcon("share", <Share2 />)}
        <span>{mode === "video" ? "اشتراک ویدیو" : "اشتراک‌گذاری"}</span>
      </Button>
    ) : (
      <Button
        className="share-action share-action--primary"
        onClick={download}
        disabled={!hasAsset}
      >
        {feedbackIcon("download", <Download />)}
        <span>{mode === "video" ? "دانلود ویدیو" : "دانلود تصویر"}</span>
      </Button>
    );

  const iconAction = (
    action: ActionId | null,
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    disabled = false,
  ) => (
    <Button
      key={label}
      variant="outline"
      size="icon"
      className="share-action share-action--icon"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {action ? feedbackIcon(action, icon) : icon}
    </Button>
  );

  const secondaryActions = (
    <div className="share-actions__row">
      {canShare &&
        (mode === "image" || videoReady) &&
        iconAction(
          "download",
          mode === "video" ? "دانلود ویدیو" : "دانلود تصویر",
          <Download />,
          download,
          !hasAsset,
        )}
      {mode === "video" && videoReady && iconAction(null, "ساخت دوباره", <RotateCcw />, generateVideo)}
      {iconAction("copyText", "کپی متن", <Copy />, () => copy("copyText", shareText), !selectedLines.length)}
      {iconAction("copyLink", "کپی لینک", <Link2 />, () => copy("copyLink", poemUrl))}
    </div>
  );

  const showSelectStep = isPhone && step === "select";

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup dir="rtl" showCloseButton={false} className="share-sheet">
        <MotionConfig reducedMotion="user">
          <header className="share-sheet__header">
            <AnimatePresence initial={false}>
              {isPhone && step === "design" && (
                <motion.span
                  className="share-sheet__back"
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 12 }}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="share-icon-button"
                    onClick={() => goTo("select")}
                    aria-label="بازگشت به انتخاب مصرع‌ها"
                  >
                    <ChevronRight />
                  </Button>
                </motion.span>
              )}
            </AnimatePresence>
            <motion.div layout="position" className="share-sheet__titles">
              <DialogTitle className="share-sheet__title">اشتراک شعر</DialogTitle>
              <p>
                {poem.title} · {poem.poet}
              </p>
            </motion.div>
            <Button
              variant="ghost"
              size="icon"
              className="share-icon-button"
              onClick={onClose}
              aria-label="بستن"
            >
              <X />
            </Button>
          </header>

          {isPhone ? (
            <div className="share-sheet__steps">
              <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                <motion.div
                  key={step}
                  className="share-sheet__step"
                  custom={direction}
                  variants={stepVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={stepTransition}
                >
                  {step === "select" ? versePicker : designer}
                </motion.div>
              </AnimatePresence>
            </div>
          ) : (
            <div className="share-sheet__body">
              {versePicker}
              {designer}
            </div>
          )}

          <footer className="share-actions">
            {showSelectStep ? (
              <Button
                className="share-action share-action--primary"
                onClick={() => goTo("design")}
                disabled={selectedLines.length === 0}
              >
                <span>پیش‌نمایش و اشتراک</span>
                <ChevronLeft />
              </Button>
            ) : (
              <>
                {primaryAction}
                {secondaryActions}
              </>
            )}
          </footer>
        </MotionConfig>
      </DialogPopup>
    </Dialog>
  );
};

export default SharePoemDialog;
