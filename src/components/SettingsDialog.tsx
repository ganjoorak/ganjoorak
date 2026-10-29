"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FaChevronLeft, FaChevronRight, FaMoon, FaSun, FaRegNewspaper, FaTimes } from "react-icons/fa";
import {
  useSettings,
  type ThemeOption,
  type FontFamilyOption,
  type PoemFontSizeOption,
  type PoemViewerComponentKey,
  type PoemViewerComponentVisibility,
  FONT_STACKS,
  POEM_FONT_SIZE_MIN,
  POEM_FONT_SIZE_MAX,
  POEM_FONT_SIZE_STEP,
  DEFAULT_POEM_FONT_SIZE,
  applyPoemFontSize,
  clampPoemFontSize,
} from "@/context/SettingsContext";
import FeedbackForm from "@/components/FeedbackForm";
import { useUpdateNotification } from "@/hooks/useUpdateNotification";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Toggle } from "@/components/ui/toggle";
import "@/styles/SettingsSheet.css";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const THEME_OPTIONS: Array<{
  value: ThemeOption;
  label: string;
  icon: React.ReactNode;
}> = [
  { value: "dark", label: "تاریک", icon: <FaMoon /> },
  { value: "light", label: "روشن", icon: <FaSun /> },
  { value: "paper", label: "کاغذی", icon: <FaRegNewspaper /> },
];

const FONT_CHOICES: Array<{
  value: FontFamilyOption;
  label: string;
  note?: string;
}> = [
  { value: "vazirmatn", label: "وزیرمتن" },
  { value: "samim", label: "صمیم" },
  { value: "tanha", label: "تنها" },
  { value: "shabnam", label: "شبنم" },
  { value: "gandom", label: "گندم" },
  { value: "parastoo", label: "پرستو" },
  { value: "sahel", label: "ساحل" },
  { value: "nahid", label: "ناهید" },
];

const persianNumberFormatter = new Intl.NumberFormat("fa-IR");

const formatPersianNumber = (value: number) =>
  persianNumberFormatter.format(value);

const POEM_VIEWER_COMPONENT_OPTIONS: Array<{
  key: Exclude<PoemViewerComponentKey, "titleSection">;
  label: string;
}> = [
  { key: "titleBreadcrumbs", label: "نمایش اثر" },
  { key: "audioPlayer", label: "پخش‌کننده صوت" },
  { key: "actionButtons", label: "دکمه‌های اشتراک و شاعر" },
];

const SettingsDialog: React.FC<SettingsDialogProps> = ({ isOpen, onClose }) => {
  const {
    settings,
    setTheme,
    setShowLineNumbers,
    setFontFamily,
    setPoemFontSize,
    setPoemViewerVisibility,
    setRandomizePoems,
    setAskRandomizePoemsOnPoetPages,
  } = useSettings();
  const [pendingTheme, setPendingTheme] = useState<ThemeOption>(settings.theme);
  const [pendingShowLineNumbers, setPendingShowLineNumbers] = useState<boolean>(
    settings.showLineNumbers,
  );
  const [pendingFontFamily, setPendingFontFamily] = useState<FontFamilyOption>(
    settings.fontFamily,
  );
  const [pendingPoemFontSize, setPendingPoemFontSize] =
    useState<PoemFontSizeOption>(settings.poemFontSize);
  const [pendingVisibility, setPendingVisibility] =
    useState<PoemViewerComponentVisibility>({
      ...settings.poemViewerVisibility,
    });
  const [pendingRandomizePoems, setPendingRandomizePoems] = useState<boolean>(
    settings.randomizePoems,
  );
  const [
    pendingAskRandomizePoemsOnPoetPages,
    setPendingAskRandomizePoemsOnPoetPages,
  ] = useState<boolean>(settings.askRandomizePoemsOnPoetPages);
  const originalThemeRef = useRef<ThemeOption>(settings.theme);
  const originalFontRef = useRef<FontFamilyOption>(settings.fontFamily);
  const originalPoemFontSizeRef = useRef<PoemFontSizeOption>(
    settings.poemFontSize,
  );
  const originalLineNumbersRef = useRef<boolean>(settings.showLineNumbers);
  const originalVisibilityRef = useRef<PoemViewerComponentVisibility>({
    ...settings.poemViewerVisibility,
  });
  const originalRandomizeRef = useRef<boolean>(settings.randomizePoems);
  const originalAskRandomizeRef = useRef<boolean>(
    settings.askRandomizePoemsOnPoetPages,
  );
  const hasSavedRef = useRef(false);
  const latestOnCloseRef = useRef(onClose);
  const { hasNewUpdates, markAsRead } = useUpdateNotification();
  // The feedback form replaces the sheet's content; the pending changes above stay in state meanwhile.
  const [view, setView] = useState<"settings" | "feedback">("settings");

  useEffect(() => {
    latestOnCloseRef.current = onClose;
  }, [onClose]);

  const restoreAppearance = useCallback(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute(
      "data-theme",
      originalThemeRef.current,
    );
    document.documentElement.setAttribute("data-font", originalFontRef.current);
    applyPoemFontSize(originalPoemFontSizeRef.current);
    setShowLineNumbers(originalLineNumbersRef.current);
    setPoemFontSize(originalPoemFontSizeRef.current);
    setPoemViewerVisibility(originalVisibilityRef.current);
    setRandomizePoems(originalRandomizeRef.current);
    setAskRandomizePoemsOnPoetPages(originalAskRandomizeRef.current);
  }, [
    setShowLineNumbers,
    setPoemFontSize,
    setPoemViewerVisibility,
    setRandomizePoems,
    setAskRandomizePoemsOnPoetPages,
  ]);

  const requestCloseWithoutSaving = useCallback(() => {
    hasSavedRef.current = false;
    restoreAppearance();
    latestOnCloseRef.current();
  }, [restoreAppearance]);

  useEffect(() => {
    setView("settings");
    if (!isOpen) {
      return undefined;
    }

    originalThemeRef.current = settings.theme;
    originalFontRef.current = settings.fontFamily;
    originalPoemFontSizeRef.current = settings.poemFontSize;
    originalLineNumbersRef.current = settings.showLineNumbers;
    originalVisibilityRef.current = { ...settings.poemViewerVisibility };
    originalRandomizeRef.current = settings.randomizePoems;
    originalAskRandomizeRef.current = settings.askRandomizePoemsOnPoetPages;
    setPendingTheme(settings.theme);
    setPendingShowLineNumbers(settings.showLineNumbers);
    setPendingFontFamily(settings.fontFamily);
    setPendingPoemFontSize(settings.poemFontSize);
    setPendingVisibility({ ...settings.poemViewerVisibility });
    setPendingRandomizePoems(settings.randomizePoems);
    setPendingAskRandomizePoemsOnPoetPages(
      settings.askRandomizePoemsOnPoetPages,
    );
    hasSavedRef.current = false;

    // Escape and outside clicks are handled by the Dialog (onOpenChange).
    return () => {
      if (!hasSavedRef.current) {
        restoreAppearance();
      }
    };
    // We intentionally only depend on the open state so we capture a single snapshot of
    // the active settings when the dialog mounts, avoiding repeated resets while the user
    // interacts with the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-theme", pendingTheme);
  }, [isOpen, pendingTheme]);

  useEffect(() => {
    if (!isOpen) return;
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-font", pendingFontFamily);
  }, [isOpen, pendingFontFamily]);

  useEffect(() => {
    if (!isOpen) return;
    if (typeof document === "undefined") return;
    applyPoemFontSize(pendingPoemFontSize);
  }, [isOpen, pendingPoemFontSize]);

  useEffect(() => {
    if (!isOpen) return;
    setShowLineNumbers(pendingShowLineNumbers);
  }, [isOpen, pendingShowLineNumbers, setShowLineNumbers]);

  useEffect(() => {
    if (!isOpen) return;
    setRandomizePoems(pendingRandomizePoems);
  }, [isOpen, pendingRandomizePoems, setRandomizePoems]);

  useEffect(() => {
    if (!isOpen) return;
    setAskRandomizePoemsOnPoetPages(pendingAskRandomizePoemsOnPoetPages);
  }, [
    isOpen,
    pendingAskRandomizePoemsOnPoetPages,
    setAskRandomizePoemsOnPoetPages,
  ]);

  const poemFontSizeDefaultRatio =
    (DEFAULT_POEM_FONT_SIZE - POEM_FONT_SIZE_MIN) /
    (POEM_FONT_SIZE_MAX - POEM_FONT_SIZE_MIN);
  const poemFontSizeDefaultMarkerStyle = {
    insetInlineStart: `calc(${poemFontSizeDefaultRatio * 100}% + ${(
      0.5 - poemFontSizeDefaultRatio
    ).toFixed(4)} * var(--range-thumb-size))`,
  } as React.CSSProperties;

  const handleSave = () => {
    hasSavedRef.current = true;
    setTheme(pendingTheme);
    setShowLineNumbers(pendingShowLineNumbers);
    setFontFamily(pendingFontFamily);
    setPoemFontSize(pendingPoemFontSize);
    setPoemViewerVisibility(pendingVisibility);
    setRandomizePoems(pendingRandomizePoems);
    setAskRandomizePoemsOnPoetPages(pendingAskRandomizePoemsOnPoetPages);
    latestOnCloseRef.current();
  };

  const handleCancel = () => {
    requestCloseWithoutSaving();
  };

  const handleVisibilityToggle = (component: PoemViewerComponentKey) => {
    setPendingVisibility((prev) => {
      const next = {
        ...prev,
        [component]: !prev[component],
      };
      setPoemViewerVisibility(next);
      return next;
    });
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) requestCloseWithoutSaving();
      }}
    >
      <DialogPopup dir="rtl" showCloseButton={false} className="settings-sheet">
        <DialogHeader className="settings-sheet-header">
          {view === "feedback" ? (
            <div className="settings-sheet-heading">
              <Button
                variant="ghost"
                size="icon-lg"
                onClick={() => setView("settings")}
                aria-label="بازگشت به تنظیمات"
              >
                <FaChevronRight />
              </Button>
              <DialogTitle>بازخورد</DialogTitle>
            </div>
          ) : (
            <DialogTitle>تنظیمات</DialogTitle>
          )}
          <Button
            variant="ghost"
            size="icon-lg"
            onClick={requestCloseWithoutSaving}
            aria-label="بستن تنظیمات"
          >
            <FaTimes />
          </Button>
        </DialogHeader>
        <DialogPanel className="settings-sheet-body">
          {view === "feedback" ? (
            <FeedbackForm onDone={() => setView("settings")} />
          ) : (
          <div aria-live="polite" className="settings-sheet-groups">
            <section className="settings-group" aria-labelledby="settings-group-look">
              <h3 id="settings-group-look" className="settings-group-title">
                ظاهر
              </h3>
              <div className="settings-group-card">
                <div className="settings-group-block">
                  <span className="settings-group-label">حالت نمایش</span>
                  <div className="settings-theme-tiles" role="group" aria-label="حالت نمایش">
                    {THEME_OPTIONS.map((option) => (
                      <Toggle
                        key={option.value}
                        variant="outline"
                        className="settings-theme-tile"
                        data-theme-option={option.value}
                        pressed={pendingTheme === option.value}
                        onPressedChange={() => setPendingTheme(option.value)}
                      >
                        <span className="settings-theme-swatch" aria-hidden="true">
                          {option.icon}
                        </span>
                        <span>{option.label}</span>
                      </Toggle>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="settings-group" aria-labelledby="settings-group-font">
              <h3 id="settings-group-font" className="settings-group-title">
                قلم شعر
              </h3>
              <div className="settings-group-card">
                <div className="settings-group-block">
                  <div className="settings-font-tiles" role="group" aria-label="قلم شعر">
                    {FONT_CHOICES.map((font) => (
                      <Toggle
                        key={font.value}
                        variant="outline"
                        className="settings-font-tile"
                        style={{ fontFamily: FONT_STACKS[font.value] }}
                        pressed={pendingFontFamily === font.value}
                        onPressedChange={() => setPendingFontFamily(font.value)}
                      >
                        <span className="settings-font-sample" aria-hidden="true">
                          آ ب
                        </span>
                        <span className="font-label">{font.label}</span>
                      </Toggle>
                    ))}
                  </div>
                </div>
                <div
                  className="settings-group-block settings-size-control"
                  style={{ "--range-thumb-size": "1rem" } as React.CSSProperties}
                >
                  <div className="settings-size-readout">
                    <span className="settings-group-label">اندازه قلم</span>
                    <span className="settings-size-actions">
                      <span className="settings-size-value">
                        {formatPersianNumber(pendingPoemFontSize)}٪
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPendingPoemFontSize(DEFAULT_POEM_FONT_SIZE)}
                        disabled={pendingPoemFontSize === DEFAULT_POEM_FONT_SIZE}
                      >
                        بازنشانی
                      </Button>
                    </span>
                  </div>
                  <div className="settings-size-track">
                    <Slider
                      min={POEM_FONT_SIZE_MIN}
                      max={POEM_FONT_SIZE_MAX}
                      step={POEM_FONT_SIZE_STEP}
                      value={[pendingPoemFontSize]}
                      onValueChange={(value) =>
                        setPendingPoemFontSize(
                          clampPoemFontSize(Array.isArray(value) ? value[0] : value),
                        )
                      }
                      aria-label="اندازه قلم شعر"
                    />
                  </div>
                  <div className="settings-size-scale" aria-hidden="true">
                    <span>{formatPersianNumber(POEM_FONT_SIZE_MIN)}٪</span>
                    <span
                      className={`settings-size-scale-default ${
                        pendingPoemFontSize === DEFAULT_POEM_FONT_SIZE ? "active" : ""
                      }`}
                      style={poemFontSizeDefaultMarkerStyle}
                    >
                      {formatPersianNumber(DEFAULT_POEM_FONT_SIZE)}٪
                    </span>
                    <span>{formatPersianNumber(POEM_FONT_SIZE_MAX)}٪</span>
                  </div>
                </div>
              </div>
            </section>

            <section className="settings-group" aria-labelledby="settings-group-reading">
              <h3 id="settings-group-reading" className="settings-group-title">
                خواندن
              </h3>
              <div className="settings-group-card">
                <label className="settings-row">
                  <span className="settings-row-text">
                    <span>شماره بیت</span>
                    <small>شماره کنار هر بیت نمایش داده شود.</small>
                  </span>
                  <Switch
                    checked={pendingShowLineNumbers}
                    onCheckedChange={setPendingShowLineNumbers}
                  />
                </label>
                <label className="settings-row">
                  <span className="settings-row-text">
                    <span>پخش تصادفی شعرها</span>
                    <small>شعرهای یک دفتر به ترتیب تصادفی بیایند.</small>
                  </span>
                  <Switch
                    checked={pendingRandomizePoems}
                    onCheckedChange={setPendingRandomizePoems}
                  />
                </label>
                <label className="settings-row">
                  <span className="settings-row-text">
                    <span>پرسش در صفحه شاعر</span>
                    <small>هنگام ورود به صفحه شاعر درباره ترتیب بپرسد.</small>
                  </span>
                  <Switch
                    checked={pendingAskRandomizePoemsOnPoetPages}
                    onCheckedChange={setPendingAskRandomizePoemsOnPoetPages}
                  />
                </label>
              </div>
            </section>

            <section className="settings-group" aria-labelledby="settings-group-poem">
              <h3 id="settings-group-poem" className="settings-group-title">
                صفحه شعر
              </h3>
              <div className="settings-group-card">
                {POEM_VIEWER_COMPONENT_OPTIONS.map((component) => (
                  <label key={component.key} className="settings-row">
                    <span className="settings-row-text">
                      <span>{component.label}</span>
                    </span>
                    <Switch
                      checked={pendingVisibility[component.key]}
                      onCheckedChange={() => handleVisibilityToggle(component.key)}
                    />
                  </label>
                ))}
              </div>
            </section>

            <section className="settings-group" aria-labelledby="settings-group-about">
              <h3 id="settings-group-about" className="settings-group-title">
                درباره و پشتیبانی
              </h3>
              <div className="settings-group-card">
                <Link
                  href="/updates"
                  className="settings-row settings-row--link"
                  onClick={() => {
                    markAsRead();
                    requestCloseWithoutSaving();
                  }}
                >
                  <span className="settings-row-text">
                    <span>بروزرسانی‌ها</span>
                  </span>
                  {hasNewUpdates && <span className="settings-row-badge">جدید</span>}
                  <FaChevronLeft className="settings-row-chevron" aria-hidden="true" />
                </Link>
                <Link
                  href="/faq"
                  className="settings-row settings-row--link"
                  onClick={requestCloseWithoutSaving}
                >
                  <span className="settings-row-text">
                    <span>پرسش‌های متداول</span>
                  </span>
                  <FaChevronLeft className="settings-row-chevron" aria-hidden="true" />
                </Link>
                <button
                  type="button"
                  className="settings-row settings-row--link"
                  onClick={() => setView("feedback")}
                >
                  <span className="settings-row-text">
                    <span>بازخورد</span>
                  </span>
                  <FaChevronLeft className="settings-row-chevron" aria-hidden="true" />
                </button>
              </div>
            </section>
          </div>
          )}
        </DialogPanel>
        {view === "settings" && (
        <DialogFooter className="settings-sheet-footer">
          <Button variant="outline" size="lg" onClick={handleCancel}>
            لغو
          </Button>
          <Button size="lg" onClick={handleSave}>
            ذخیره
          </Button>
        </DialogFooter>
        )}
      </DialogPopup>
    </Dialog>
  );
};

export default SettingsDialog;
