"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  FaCheck,
  FaColumns,
  FaCopy,
  FaDownload,
  FaPalette,
  FaTimes,
} from "react-icons/fa";
import type { Poem } from "@/types/poem";
import { logger } from "@/utils/logger";
import { Button } from "@/components/ui/button";
import { Dialog, DialogPopup, DialogTitle } from "@/components/ui/dialog";
import { Toggle } from "@/components/ui/toggle";
import {
  FONT_STACKS,
  useSettings,
  type FontFamilyOption,
} from "@/context/SettingsContext";

interface SharePoemDialogProps {
  poem: Poem;
  isOpen: boolean;
  onClose: () => void;
  poetSlug?: string;
}

type ShareThemeId = "night" | "paper" | "ink";
type ShareImageLayout = "single" | "couplet";
type ShareActionId = "copyLink" | "copyText" | "downloadImage";
type ShareActionFeedback = {
  action: ShareActionId;
  state: "success" | "error";
} | null;

const SHARE_FONT_CHOICES: Array<{ value: FontFamilyOption; label: string }> = [
  { value: "vazirmatn", label: "وزیرمتن" },
  { value: "samim", label: "صمیم" },
  { value: "gandom", label: "گندم" },
  { value: "parastoo", label: "پرستو" },
  { value: "sahel", label: "ساحل" },
];

const SHARE_IMAGE_LAYOUTS: Array<{ value: ShareImageLayout; label: string }> = [
  { value: "single", label: "تک‌ستون" },
  { value: "couplet", label: "دوستون" },
];

const SHARE_THEMES: Array<{
  id: ShareThemeId;
  label: string;
  background: string;
  accent: string;
  title: string;
  text: string;
  muted: string;
  border: string;
  brand: string;
}> = [
  {
    id: "night",
    label: "شب",
    background: "#111111",
    accent: "rgba(255,255,255,0.12)",
    title: "rgba(255,255,255,0.92)",
    text: "rgba(255,255,255,0.90)",
    muted: "rgba(255,255,255,0.62)",
    border: "rgba(255,255,255,0.16)",
    brand: "rgba(255,255,255,0.52)",
  },
  {
    id: "paper",
    label: "کاغذ",
    background: "#f4ead7",
    accent: "rgba(115,78,38,0.12)",
    title: "#3d2b1f",
    text: "#493527",
    muted: "rgba(61,43,31,0.68)",
    border: "rgba(61,43,31,0.18)",
    brand: "rgba(61,43,31,0.54)",
  },
  {
    id: "ink",
    label: "مرکب",
    background: "#f7f7f4",
    accent: "rgba(20,24,28,0.08)",
    title: "#17191d",
    text: "#202329",
    muted: "rgba(23,25,29,0.62)",
    border: "rgba(23,25,29,0.16)",
    brand: "rgba(23,25,29,0.50)",
  },
];

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

const toBlob = async (dataUrl: string) => {
  const response = await fetch(dataUrl);
  return response.blob();
};

const wrapCanvasText = (
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let currentLine = "";

  words.forEach((word) => {
    const testLine = currentLine ? `${currentLine} ${word}` : word;

    if (context.measureText(testLine).width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
};

const getCanvasFont = (weight: number, size: number, fontStack: string) =>
  `${weight} ${size}px ${fontStack}`;

const selectedLineFormatter = new Intl.NumberFormat("fa-IR");

const formatSelectedLineCount = (count: number) =>
  `${selectedLineFormatter.format(count)} مصرع انتخاب شده`;

const fitPoemLines = ({
  context,
  lines,
  fontStack,
  maxWidth,
  maxHeight,
}: {
  context: CanvasRenderingContext2D;
  lines: string[];
  fontStack: string;
  maxWidth: number;
  maxHeight: number;
}) => {
  const minFontSize = 24;
  const maxFontSize = 42;

  for (let fontSize = maxFontSize; fontSize >= minFontSize; fontSize -= 2) {
    context.font = getCanvasFont(500, fontSize, fontStack);

    const renderedLines = lines.flatMap((line) =>
      wrapCanvasText(context, line, maxWidth),
    );

    const lineHeight = Math.round(fontSize * 1.75);

    if (renderedLines.length * lineHeight <= maxHeight) {
      return { renderedLines, fontSize, lineHeight };
    }
  }

  context.font = getCanvasFont(500, minFontSize, fontStack);

  const lineHeight = Math.round(minFontSize * 1.75);
  const maxLineCount = Math.max(1, Math.floor(maxHeight / lineHeight));

  const renderedLines = lines
    .flatMap((line) => wrapCanvasText(context, line, maxWidth))
    .slice(0, maxLineCount);

  if (renderedLines.length > 0) {
    renderedLines[renderedLines.length - 1] =
      renderedLines[renderedLines.length - 1].replace(/\s+$/, "") + "…";
  }

  return { renderedLines, fontSize: minFontSize, lineHeight };
};

const chunkLines = (lines: string[], size: number) =>
  Array.from({ length: Math.ceil(lines.length / size) }, (_, index) =>
    lines.slice(index * size, index * size + size),
  );

const fitCoupletLines = ({
  context,
  lines,
  fontStack,
  maxWidth,
  maxHeight,
}: {
  context: CanvasRenderingContext2D;
  lines: string[];
  fontStack: string;
  maxWidth: number;
  maxHeight: number;
}) => {
  const minFontSize = 22;
  const maxFontSize = 38;
  const columnGap = 48;
  const pairGapRatio = 0.52;
  const columnWidth = (maxWidth - columnGap) / 2;
  const pairs = chunkLines(lines, 2);

  const buildRows = (fontSize: number) => {
    context.font = getCanvasFont(500, fontSize, fontStack);
    const lineHeight = Math.round(fontSize * 1.62);
    const pairGap = Math.round(lineHeight * pairGapRatio);
    const rows = pairs.map(([right = "", left = ""]) => {
      const rightLines = right
        ? wrapCanvasText(context, right, columnWidth)
        : [];
      const leftLines = left ? wrapCanvasText(context, left, columnWidth) : [];
      const lineCount = Math.max(rightLines.length, leftLines.length, 1);

      return {
        rightLines,
        leftLines,
        lineCount,
        height: lineCount * lineHeight,
      };
    });
    const totalHeight =
      rows.reduce((sum, row) => sum + row.height, 0) +
      Math.max(0, rows.length - 1) * pairGap;

    return {
      rows,
      fontSize,
      lineHeight,
      pairGap,
      columnGap,
      columnWidth,
      totalHeight,
    };
  };

  for (let fontSize = maxFontSize; fontSize >= minFontSize; fontSize -= 2) {
    const layout = buildRows(fontSize);
    if (layout.totalHeight <= maxHeight) {
      return layout;
    }
  }

  const layout = buildRows(minFontSize);
  const visibleRows = [];
  let usedHeight = 0;

  for (const row of layout.rows) {
    const extraGap = visibleRows.length > 0 ? layout.pairGap : 0;
    if (usedHeight + extraGap + row.height > maxHeight) {
      break;
    }
    usedHeight += extraGap + row.height;
    visibleRows.push(row);
  }

  if (visibleRows.length === 0 && layout.rows[0]) {
    visibleRows.push(layout.rows[0]);
    usedHeight = layout.rows[0].height;
  }

  const lastRow = visibleRows[visibleRows.length - 1];
  const lastLines =
    lastRow?.leftLines.length ? lastRow.leftLines : lastRow?.rightLines;
  if (lastLines?.length) {
    lastLines[lastLines.length - 1] =
      lastLines[lastLines.length - 1].replace(/\s+$/, "") + "…";
  }

  return {
    ...layout,
    rows: visibleRows,
    totalHeight: usedHeight,
  };
};

const createShareImage = async ({
  poem,
  lines,
  theme,
  fontStack,
  imageLayout,
}: {
  poem: Poem;
  lines: string[];
  theme: (typeof SHARE_THEMES)[number];
  fontStack: string;
  imageLayout: ShareImageLayout;
}) => {
  if (typeof document === "undefined") {
    return "";
  }

  await document.fonts?.ready;

  const canvas = document.createElement("canvas");
  const scale = 2;
  const width = 1080;
  const height = 1350;

  canvas.width = width * scale;
  canvas.height = height * scale;

  const context = canvas.getContext("2d");

  if (!context) {
    return "";
  }

  context.scale(scale, scale);

  context.fillStyle = theme.background;
  context.fillRect(0, 0, width, height);

  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, theme.accent);
  gradient.addColorStop(0.45, "rgba(255,255,255,0.02)");
  gradient.addColorStop(1, theme.accent);

  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  context.strokeStyle = theme.border;
  context.lineWidth = 2;
  context.strokeRect(56, 56, width - 112, height - 112);

  context.direction = "rtl";
  context.textAlign = "center";

  context.fillStyle = theme.title;
  context.font = getCanvasFont(700, 50, fontStack);

  const titleLines = wrapCanvasText(context, poem.title, width - 210).slice(
    0,
    2,
  );

  titleLines.forEach((line, index) => {
    context.fillText(line, width / 2, 160 + index * 62);
  });

  context.fillStyle = theme.muted;
  context.font = getCanvasFont(400, 31, fontStack);
  context.fillText(poem.poet, width / 2, 215 + (titleLines.length - 1) * 62);

  context.fillStyle = theme.text;

  const textTop = 340;
  const textBottom = height - 185;

  if (imageLayout === "couplet") {
    const layout = fitCoupletLines({
      context,
      lines,
      fontStack,
      maxWidth: width - 210,
      maxHeight: textBottom - textTop,
    });

    context.font = getCanvasFont(500, layout.fontSize, fontStack);
    const rightColumnX =
      width / 2 + layout.columnGap / 2 + layout.columnWidth / 2;
    const leftColumnX =
      width / 2 - layout.columnGap / 2 - layout.columnWidth / 2;
    let y = Math.max(textTop, height / 2 - layout.totalHeight / 2);

    layout.rows.forEach((row) => {
      for (let index = 0; index < row.lineCount; index += 1) {
        const lineY = y + index * layout.lineHeight;
        if (row.rightLines[index]) {
          context.fillText(row.rightLines[index], rightColumnX, lineY);
        }
        if (row.leftLines[index]) {
          context.fillText(row.leftLines[index], leftColumnX, lineY);
        }
      }

      y += row.height + layout.pairGap;
    });
  } else {
    const { renderedLines, fontSize, lineHeight } = fitPoemLines({
      context,
      lines,
      fontStack,
      maxWidth: width - 210,
      maxHeight: textBottom - textTop,
    });

    context.font = getCanvasFont(500, fontSize, fontStack);

    const totalTextHeight = renderedLines.length * lineHeight;
    let y = Math.max(textTop, height / 2 - totalTextHeight / 2);

    renderedLines.forEach((line) => {
      context.fillText(line, width / 2, y);
      y += lineHeight;
    });
  }

  context.fillStyle = theme.brand;
  context.font = getCanvasFont(400, 26, fontStack);
  context.fillText("ganjoorak.ir", width / 2, height - 120);

  return canvas.toDataURL("image/png");
};

const SharePoemDialog: React.FC<SharePoemDialogProps> = ({
  poem,
  isOpen,
  onClose,
  poetSlug,
}) => {
  const { settings } = useSettings();

  const [selectedLines, setSelectedLines] = useState<number[]>([]);
  const [selectedThemeId, setSelectedThemeId] = useState<ShareThemeId>("night");
  const [selectedImageLayout, setSelectedImageLayout] =
    useState<ShareImageLayout>("single");
  const [selectedFontFamily, setSelectedFontFamily] =
    useState<FontFamilyOption>(settings.fontFamily);
  const [imageUrl, setImageUrl] = useState("");
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<ShareActionFeedback>(null);
  const [mobileStep, setMobileStep] = useState<"select" | "preview">("select");

  const poemUrl = useMemo(() => buildPoemUrl(poem, poetSlug), [poem, poetSlug]);

  const lines = useMemo(
    () =>
      poem.plainText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    [poem.plainText],
  );

  const shareableLines = useMemo(() => lines, [lines]);

  const selectedTextLines = useMemo(
    () =>
      selectedLines
        .map((index) => shareableLines[index])
        .filter(Boolean),
    [selectedLines, shareableLines],
  );

  const selectedTheme = useMemo(
    () =>
      SHARE_THEMES.find((theme) => theme.id === selectedThemeId) ??
      SHARE_THEMES[0],
    [selectedThemeId],
  );

  const shareText = useMemo(
    () =>
      [
        selectedTextLines.join("\n"),
        "",
        `${poem.title} - ${poem.poet}`,
        poemUrl,
      ]
        .filter(Boolean)
        .join("\n"),
    [poem.poet, poem.title, poemUrl, selectedTextLines],
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setActionFeedback(null);
    setMobileStep("select");
    setSelectedFontFamily(settings.fontFamily);
    setSelectedLines(shareableLines.slice(0, 4).map((_, index) => index));
  }, [isOpen, poem.id, settings.fontFamily, shareableLines]);

  useEffect(() => {
    if (!actionFeedback) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setActionFeedback(null);
    }, 1400);

    return () => window.clearTimeout(timeoutId);
  }, [actionFeedback]);

  useEffect(() => {
    if (!isOpen || selectedTextLines.length === 0) {
      setImageUrl("");
      return;
    }

    let cancelled = false;

    const generate = async () => {
      setIsGeneratingImage(true);

      try {
        const nextImageUrl = await createShareImage({
          poem,
          lines: selectedTextLines,
          theme: selectedTheme,
          fontStack: FONT_STACKS[selectedFontFamily],
          imageLayout: selectedImageLayout,
        });

        if (!cancelled) {
          setImageUrl(nextImageUrl);
        }
      } catch (error) {
        logger.error("Error creating share image:", error);
      } finally {
        if (!cancelled) {
          setIsGeneratingImage(false);
        }
      }
    };

    generate();

    return () => {
      cancelled = true;
    };
  }, [
    isOpen,
    poem,
    selectedFontFamily,
    selectedImageLayout,
    selectedTextLines,
    selectedTheme,
  ]);

  const toggleLine = (index: number) => {
    setActionFeedback(null);

    setSelectedLines((prev) => {
      if (prev.includes(index)) {
        return prev.filter((item) => item !== index);
      }

      return [...prev, index].sort((a, b) => a - b);
    });
  };

  const areAllLinesSelected =
    shareableLines.length > 0 && selectedLines.length === shareableLines.length;

  const toggleAllLines = () => {
    setActionFeedback(null);
    setSelectedLines(
      areAllLinesSelected ? [] : shareableLines.map((_, index) => index),
    );
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setActionFeedback({ action: "copyText", state: "success" });
    } catch (error) {
      logger.error("Failed to copy share text:", error);
      setActionFeedback({ action: "copyText", state: "error" });
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(poemUrl);
      setActionFeedback({ action: "copyLink", state: "success" });
    } catch (error) {
      logger.error("Failed to copy link:", error);
      setActionFeedback({ action: "copyLink", state: "error" });
    }
  };

  const downloadImage = () => {
    if (!imageUrl) {
      return;
    }

    const link = document.createElement("a");
    link.href = imageUrl;
    link.download = `ganjoorak-${poem.id}.png`;
    link.click();
    setActionFeedback({ action: "downloadImage", state: "success" });
  };

  const getActionButtonVariant = (action: ShareActionId) => {
    if (actionFeedback?.action !== action) {
      return "outline" as const;
    }

    return actionFeedback.state === "success"
      ? ("default" as const)
      : ("destructive" as const);
  };

  const getActionIcon = (action: ShareActionId, fallback: React.ReactNode) => {
    if (actionFeedback?.action === action && actionFeedback.state === "success") {
      return <FaCheck />;
    }

    return fallback;
  };

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
        className={`lyrics-share-panel lyrics-share-panel--${mobileStep} max-w-none`}
      >
              <header className="lyrics-share-header">
                <div>
                  <DialogTitle>اشتراک شعر</DialogTitle>
                  <p>{poem.title}</p>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11"
                  onClick={onClose}
                  aria-label="بستن"
                >
                  <FaTimes />
                </Button>
              </header>

              <div className="lyrics-share-body">
                <section className="lyrics-share-controls">
                  <div className="lyrics-share-selection-bar">
                    <span>{formatSelectedLineCount(selectedLines.length)}</span>
                    <Button variant="outline" size="sm" onClick={toggleAllLines}>
                      {areAllLinesSelected ? "لغو انتخاب همه" : "انتخاب همه"}
                    </Button>
                  </div>

                  <div
                    className="lyrics-share-lines modern-scrollbar"
                    aria-label="انتخاب مصرع‌ها"
                  >
                    {shareableLines.map((line, index) => {
                      const isSelected = selectedLines.includes(index);

                      return (
                        <Toggle
                          key={`${line}-${index}`}
                          variant="outline"
                          className="h-auto whitespace-normal data-pressed:border-primary"
                          pressed={isSelected}
                          onPressedChange={() => toggleLine(index)}
                        >
                          <span>{line}</span>
                          {isSelected && <FaCheck aria-hidden="true" />}
                        </Toggle>
                      );
                    })}
                  </div>

                  <Button
                    className="lyrics-share-mobile-next h-11"
                    onClick={() => setMobileStep("preview")}
                    disabled={selectedTextLines.length === 0}
                  >
                    پیش‌نمایش
                  </Button>
                </section>

                <section
                  className="lyrics-share-preview"
                  aria-label="پیش‌نمایش تصویر"
                >
                  <div className="lyrics-share-preview-frame">
                    {isGeneratingImage && <p>در حال ساخت تصویر...</p>}

                    {!isGeneratingImage && imageUrl && (
                      <img src={imageUrl} alt="پیش‌نمایش تصویر اشتراک شعر" />
                    )}
                  </div>

                  <div className="lyrics-share-options">
                    <div
                      className="lyrics-share-theme-bar"
                      aria-label="انتخاب قالب تصویر"
                    >
                      <span>
                        <FaPalette aria-hidden="true" />
                        قالب
                      </span>

                      <div>
                        {SHARE_THEMES.map((theme) => (
                          <Toggle
                            key={theme.id}
                            variant="outline"
                            size="sm"
                            className="rounded-full"
                            pressed={theme.id === selectedThemeId}
                            onPressedChange={() => setSelectedThemeId(theme.id)}
                          >
                            <span>{theme.label}</span>
                          </Toggle>
                        ))}
                      </div>
                    </div>

                    <div
                      className="lyrics-share-theme-bar lyrics-share-font-bar"
                      aria-label="انتخاب قلم تصویر"
                    >
                      <span>قلم</span>

                      <div>
                        {SHARE_FONT_CHOICES.map((font) => (
                          <Toggle
                            key={font.value}
                            variant="outline"
                            size="sm"
                            className="rounded-full"
                            pressed={font.value === selectedFontFamily}
                            style={{ fontFamily: FONT_STACKS[font.value] }}
                            onPressedChange={() => setSelectedFontFamily(font.value)}
                          >
                            <span className="lyrics-share-font-label">
                              {font.label}
                            </span>
                          </Toggle>
                        ))}
                      </div>
                    </div>

                    <div
                      className="lyrics-share-theme-bar"
                      aria-label="انتخاب چیدمان تصویر"
                    >
                      <span>
                        <FaColumns aria-hidden="true" />
                        چیدمان
                      </span>

                      <div>
                        {SHARE_IMAGE_LAYOUTS.map((layout) => (
                          <Toggle
                            key={layout.value}
                            variant="outline"
                            size="sm"
                            className="rounded-full"
                            pressed={layout.value === selectedImageLayout}
                            onPressedChange={() => setSelectedImageLayout(layout.value)}
                          >
                            <span>{layout.label}</span>
                          </Toggle>
                        ))}
                      </div>
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    className="lyrics-share-mobile-back h-11"
                    onClick={() => setMobileStep("select")}
                  >
                    تغییر انتخاب
                  </Button>
                </section>
              </div>

              <footer className="lyrics-share-actions">
                <Button
                  variant={getActionButtonVariant("copyLink")}
                  className="h-11"
                  onClick={copyLink}
                >
                  {getActionIcon("copyLink", <FaCopy />)}
                  <span>کپی لینک</span>
                </Button>

                <Button
                  variant={getActionButtonVariant("copyText")}
                  className="h-11"
                  onClick={copyText}
                >
                  {getActionIcon("copyText", <FaCopy />)}
                  <span>کپی متن</span>
                </Button>

                <Button
                  variant={getActionButtonVariant("downloadImage")}
                  className="h-11"
                  onClick={downloadImage}
                  disabled={!imageUrl}
                >
                  {getActionIcon("downloadImage", <FaDownload />)}
                  <span>دانلود تصویر</span>
                </Button>
              </footer>
      </DialogPopup>
    </Dialog>
  );
};

export default SharePoemDialog;
