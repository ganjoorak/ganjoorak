"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useReducedMotion,
  type Variants,
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
  Pause,
  Play,
  RotateCcw,
  Share2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import ganjoorApi from "@/api/GanjoorApi";
import type { Poem, VerseSync } from "@/types/poem";
import { logger } from "@/utils/logger";
import { Button } from "@/components/ui/button";
import { Dialog, DialogPopup, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsIndicator, TabsList, TabsTab } from "@/components/ui/tabs";
import {
  FONT_STACKS,
  useSettings,
  type FontFamilyOption,
} from "@/context/SettingsContext";
import {
  SHARE_CARD_FORMATS,
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
  buildShareTimeline,
  drawShareFrame,
  loadRecitationAudio,
  pickShareVideoMime,
  recordShareVideo,
  type ShareVideoResult,
} from "@/components/share/shareVideo";
import "@/styles/SharePoemDialog.css";

interface SharePoemDialogProps {
  poem: Poem;
  isOpen: boolean;
  onClose: () => void;
  poetSlug?: string;
}

type ShareMode = "image" | "video";
type Step = "select" | "design";
type ActionId = "copyText" | "copyLink" | "download" | "share";
type Feedback = { action: ActionId; ok: boolean } | null;

type VideoState =
  | { status: "idle" }
  | { status: "preparing"; label: string }
  | { status: "recording"; progress: number }
  | { status: "done"; result: ShareVideoResult; url: string }
  | { status: "error"; message: string };

interface SharePrefs {
  theme?: ShareCardThemeId;
  format?: ShareCardFormat;
  layout?: ShareCardLayout;
  font?: FontFamilyOption;
}

const PREFS_KEY = "ganjoorak-share-prefs";
const PREVIEW_SCALE = 0.75;

const SHARE_FONT_CHOICES: Array<{ value: FontFamilyOption; label: string }> = [
  { value: "vazirmatn", label: "وزیرمتن" },
  { value: "samim", label: "صمیم" },
  { value: "gandom", label: "گندم" },
  { value: "parastoo", label: "پرستو" },
  { value: "sahel", label: "ساحل" },
];

const LAYOUT_CHOICES: Array<{ value: ShareCardLayout; label: string }> = [
  { value: "single", label: "تک‌ستون" },
  { value: "couplet", label: "دوستون" },
];

const faNumber = new Intl.NumberFormat("fa-IR");

const readPrefs = (): SharePrefs => {
  try {
    return JSON.parse(window.localStorage.getItem(PREFS_KEY) || "{}");
  } catch {
    return {};
  }
};

const writePrefs = (prefs: SharePrefs) => {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode: preferences just don't stick.
  }
};

const buildPoemUrl = (poem: Poem, poetSlug?: string) => {
  const baseUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://ganjoorak.ir";

  if (poem.isCustom) {
    return `${baseUrl}/${poetSlug || poem.poetSlug}/${poem.id}`;
  }

  return `${baseUrl}/poem/${poem.id}`;
};

// Same breakpoint as the dialog primitive's bottom sheet (Tailwind `sm`).
const PHONE_QUERY = "(max-width: 639px)";
const subscribePhone = (callback: () => void) => {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
};
const useIsPhone = () =>
  useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );

const saveBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
};

// RTL: moving forward slides the new step in from the left.
const stepVariants: Variants = {
  enter: (direction: number) => ({ x: direction * -48, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({ x: direction * 48, opacity: 0 }),
};

const stepTransition = { type: "spring", stiffness: 420, damping: 38, mass: 0.9 } as const;

const barSpring = { type: "spring", stiffness: 520, damping: 38 } as const;

const fade = {
  initial: { opacity: 0, scale: 0.6 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.6 },
  transition: { duration: 0.16 },
};

type TabOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
  title?: string;
  style?: React.CSSProperties;
};

/** One choice per row, in the pill tabs the poets page uses for its categories. */
function OptionTabs<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<TabOption<T>>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="share-option">
      <Tabs
        value={value}
        onValueChange={(next) => onChange(next as T)}
        className="share-option__tabs min-w-0 flex-1"
      >
        <TabsList className="share-tabs relative" aria-label={label}>
          <TabsIndicator />
          {options.map((option) => (
            <TabsTab
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              title={option.title}
              style={option.style}
              className="relative data-active:bg-transparent data-active:shadow-none"
            >
              {option.label}
            </TabsTab>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}

const SharePoemDialog: React.FC<SharePoemDialogProps> = ({
  poem,
  isOpen,
  onClose,
  poetSlug,
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
  const [verseSync, setVerseSync] = useState<VerseSync[] | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [video, setVideo] = useState<VideoState>({ status: "idle" });
  const [layout, setLayout] = useState<ShareCardLayoutResult | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(true);
  const [panel, setPanel] = useState<"type" | "voice" | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [support, setSupport] = useState({ shareFiles: false, share: false, video: false });

  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const imageBlobRef = useRef<Blob | null>(null);
  const abortRef = useRef<AbortController | null>(null);
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
    setSelected(lines.slice(0, 4).map((_, index) => index));
    setStep("select");
    setDirection(1);
    setMode("image");
    setRecitationIndex(-1);
    setPanel(null);
    setFeedback(null);
    setVideo({ status: "idle" });
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

  // A finished video no longer matches once anything about it changes.
  useEffect(() => {
    abortRef.current?.abort();
    setVideo((current) => {
      if (current.status === "done") URL.revokeObjectURL(current.url);
      return { status: "idle" };
    });
  }, [cardInput, recitationIndex]);

  useEffect(() => {
    if (!isOpen) abortRef.current?.abort();
  }, [isOpen]);

  // Verse timings for the chosen recitation, so lines appear as recited.
  useEffect(() => {
    setVerseSync(null);
    if (!recitation?.inSyncWithText) return;
    let cancelled = false;
    ganjoorApi
      .getRecitationVerses(recitation.id)
      .then((data) => !cancelled && setVerseSync(data))
      .catch((error) => logger.error("Error fetching verse sync:", error));
    return () => {
      cancelled = true;
    };
  }, [recitation]);

  const syncFor = useCallback(
    (shown: ShareCardLayoutResult, audioSeconds?: number) => {
      if (!verseSync?.length || !recitation) return null;
      const visible = selectedLines.slice(0, shown.lineGroups.length);
      const starts = visible.map(
        (line) => verseSync.find((v) => v.verseOrder === line.index + 1)?.audioStartMilliseconds,
      );
      if (!starts.length || starts.some((s) => s === undefined)) return null;
      const last = visible[visible.length - 1];
      const nextStart = verseSync.find((v) => v.verseOrder === last.index + 2)?.audioStartMilliseconds;
      const lastStart = starts[starts.length - 1] as number;
      const endMs =
        nextStart ?? (audioSeconds ? audioSeconds * 1000 : lastStart + 4500);
      return { starts: starts as number[], endMs };
    },
    [recitation, selectedLines, verseSync],
  );

  const previewTimeline = useMemo(
    () => (layout ? buildShareTimeline(layout, syncFor(layout)) : null),
    [layout, syncFor],
  );

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

  const allSelected = lines.length > 0 && selected.length === lines.length;

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

  const generateVideo = async () => {
    if (!layout) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    try {
      let audio: AudioBuffer | null = null;
      if (recitation) {
        setVideo({ status: "preparing", label: "دریافت صدای خوانش…" });
        try {
          audio = await loadRecitationAudio(recitation.mp3Url, signal);
        } catch (error) {
          if (signal.aborted) throw error;
          logger.error("Recitation audio unavailable:", error);
        }
      }
      setVideo({ status: "preparing", label: "آماده‌سازی…" });
      await ensureShareFonts(fontStack);
      const timeline = buildShareTimeline(layout, audio ? syncFor(layout, audio.duration) : null);
      setVideo({ status: "recording", progress: 0 });
      const result = await recordShareVideo({
        layout,
        timeline,
        audio,
        signal,
        onProgress: (progress) => setVideo({ status: "recording", progress }),
      });
      if (signal.aborted) return;
      setVideo({ status: "done", result, url: URL.createObjectURL(result.blob) });
    } catch (error) {
      if ((error as DOMException)?.name === "AbortError" || signal.aborted) {
        setVideo({ status: "idle" });
        return;
      }
      logger.error("Video export failed:", error);
      setVideo({ status: "error", message: "ساخت ویدیو ممکن نشد. دوباره امتحان کنید." });
    }
  };

  const cancelVideo = () => {
    abortRef.current?.abort();
    setVideo({ status: "idle" });
  };

  const busy = video.status === "preparing" || video.status === "recording";
  const progress =
    video.status === "recording" ? video.progress : video.status === "preparing" ? 0 : 1;

  const feedbackIcon = (action: ActionId, icon: React.ReactNode) => (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span key={feedback?.action === action ? (feedback.ok ? "ok" : "err") : "icon"} className="share-action__icon" {...fade}>
        {feedback?.action === action ? feedback.ok ? <Check /> : <X /> : icon}
      </motion.span>
    </AnimatePresence>
  );

  const versePicker = (
    <section className="share-pane share-pane--verses" aria-label="انتخاب مصرع‌ها">
      <div className="share-pane__bar">
        <span className="share-count" aria-live="polite">
          <motion.b key={selected.length} initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
            {faNumber.format(selected.length)}
          </motion.b>{" "}
          مصرع انتخاب شده
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="share-link-button"
          onClick={() => setSelected(allSelected ? [] : lines.map((_, index) => index))}
        >
          {allSelected ? "لغو همه" : "انتخاب همه"}
        </Button>
      </div>
      <div className="share-lines">
        {lines.map((line, index) => {
          const isSelected = selected.includes(index);
          return (
            <button
              key={`${index}-${line}`}
              type="button"
              aria-pressed={isSelected}
              className="share-line"
              data-beyt-end={index % 2 === 1 || undefined}
              onClick={() => toggleLine(index)}
            >
              <span className="share-line__text">{line}</span>
              <span className="share-line__check" aria-hidden="true">
                <AnimatePresence initial={false}>
                  {isSelected && (
                    <motion.span
                      initial={{ scale: 0.4, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.4, opacity: 0 }}
                      transition={{ type: "spring", stiffness: 600, damping: 30 }}
                    >
                      <Check />
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );

  const { width: cardW, height: cardH } = SHARE_CARD_FORMATS[format];

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

      <div className="share-stage">
        <div
          className="share-preview"
          style={
            { "--ratio": cardW / cardH } as React.CSSProperties
          }
        >
          <AnimatePresence initial={false}>
            {showVideoResult ? (
              <motion.video
                key="video"
                className="share-preview__media"
                src={video.url}
                controls
                playsInline
                autoPlay
                loop
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            ) : (
              <motion.canvas
                key="canvas"
                ref={previewRef}
                className="share-preview__media"
                role="img"
                aria-label="پیش‌نمایش کارت شعر"
                initial={{ opacity: 0 }}
                animate={{ opacity: layout ? 1 : 0 }}
                exit={{ opacity: 0 }}
              />
            )}
          </AnimatePresence>

          {!layout && selectedLines.length === 0 && (
            <p className="share-preview__empty">مصرعی انتخاب نشده</p>
          )}

          {mode === "video" && !showVideoResult && !busy && layout && (
            <button
              type="button"
              className="share-preview__play"
              onClick={() => setPreviewPlaying((p) => !p)}
              aria-label={previewPlaying && !reduceMotion ? "توقف پیش‌نمایش" : "پخش پیش‌نمایش"}
            >
              {previewPlaying && !reduceMotion ? <Pause /> : <Play />}
            </button>
          )}

          <AnimatePresence>
            {busy && (
              <motion.div
                className="share-progress"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="share-progress__ring" style={{ "--p": progress } as React.CSSProperties}>
                  <span>{faNumber.format(Math.round(progress * 100))}٪</span>
                </div>
                <p>{video.status === "preparing" ? video.label : "در حال ساخت ویدیو…"}</p>
                <Button variant="secondary" className="share-progress__cancel" onClick={cancelVideo}>
                  <X /> لغو
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {(layout?.truncated || video.status === "error") && (
          <motion.p
            className="share-note"
            data-error={video.status === "error" || undefined}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            {video.status === "error" ? video.message : "همه‌ی مصرع‌ها در کارت جا نشدند."}
          </motion.p>
        )}
      </AnimatePresence>

      <div className="share-bar-wrap" ref={barRef}>
        <AnimatePresence>
          {panel && (
            <motion.div
              className="share-popover"
              role="dialog"
              aria-label={panel === "voice" ? "صدای خوانش" : "قلم و چیدمان"}
              initial={{ opacity: 0, y: 8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
            >
              {panel === "type" ? (
                <>
                  <OptionTabs<ShareCardLayout>
                    label="چیدمان"
                    value={cardLayout}
                    onChange={setCardLayout}
                    options={LAYOUT_CHOICES}
                  />
                  <OptionTabs<FontFamilyOption>
                    label="قلم"
                    value={fontFamily}
                    onChange={setFontFamily}
                    options={SHARE_FONT_CHOICES.map((font) => ({
                      ...font,
                      style: { fontFamily: FONT_STACKS[font.value] },
                    }))}
                  />
                </>
              ) : (
                <div className="share-voices" role="radiogroup" aria-label="صدای خوانش">
                  {[{ value: -1, label: "بی‌صدا" }, ...recitations.map((item, index) => ({
                    value: index,
                    label: item.audioArtist || `خوانش ${faNumber.format(index + 1)}`,
                  }))].map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      role="radio"
                      aria-checked={recitationIndex === item.value}
                      className="share-voice"
                      onClick={() => {
                        setRecitationIndex(item.value);
                        setPanel(null);
                      }}
                    >
                      {item.label}
                      {recitationIndex === item.value && <Check aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="share-bar">
          <div className="share-bar__group" role="radiogroup" aria-label="رنگ کارت">
            {SHARE_CARD_THEMES.map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={item.id === themeId}
                aria-label={item.label}
                title={item.label}
                className="share-bar__item"
                onClick={() => setThemeId(item.id)}
              >
                {item.id === themeId && (
                  <motion.span layoutId="share-bar-theme" className="share-bar__ring" transition={barSpring} />
                )}
                <span
                  className="share-bar__swatch"
                  style={{
                    background: `linear-gradient(160deg, ${item.backgroundTop}, ${item.backgroundBottom})`,
                  }}
                />
              </button>
            ))}
          </div>

          <span className="share-bar__divider" aria-hidden="true" />

          <div className="share-bar__group" role="radiogroup" aria-label="اندازه">
            {(Object.keys(SHARE_CARD_FORMATS) as ShareCardFormat[]).map((key) => {
              const { width: w, height: h, label } = SHARE_CARD_FORMATS[key];
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={key === format}
                  aria-label={label}
                  title={label}
                  className="share-bar__item"
                  onClick={() => setFormat(key)}
                >
                  {key === format && (
                    <motion.span layoutId="share-bar-format" className="share-bar__ring" transition={barSpring} />
                  )}
                  <span className="share-bar__ratio" style={{ width: `${(w / h) * 1.05}rem`, height: "1.05rem" }} />
                </button>
              );
            })}
          </div>

          <span className="share-bar__divider" aria-hidden="true" />

          <button
            type="button"
            className="share-bar__item share-bar__text"
            aria-label="قلم و چیدمان"
            title="قلم و چیدمان"
            aria-expanded={panel === "type"}
            data-open={panel === "type" || undefined}
            onClick={() => setPanel((open) => (open === "type" ? null : "type"))}
            style={{ fontFamily: fontStack }}
          >
            Aa
          </button>

          {mode === "video" && recitations.length > 0 && (
            <button
              type="button"
              className="share-bar__item share-bar__text"
              aria-label="صدای خوانش"
              title="صدای خوانش"
              aria-expanded={panel === "voice"}
              data-open={panel === "voice" || recitationIndex >= 0 || undefined}
              onClick={() => setPanel((open) => (open === "voice" ? null : "voice"))}
            >
              {recitationIndex >= 0 ? <Volume2 /> : <VolumeX />}
            </button>
          )}
        </div>
      </div>
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
