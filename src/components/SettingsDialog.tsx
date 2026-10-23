"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { FaMoon, FaSun, FaRegNewspaper, FaTimes } from "react-icons/fa";
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

  const toggleRowClass =
    "flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-lg border border-border px-3 py-2 text-sm";

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) requestCloseWithoutSaving();
      }}
    >
      <DialogPopup dir="rtl" showCloseButton={false} className="sm:max-w-xl">
        <DialogHeader className="flex-row items-center justify-between">
          <DialogTitle>تنظیمات</DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            onClick={requestCloseWithoutSaving}
            aria-label="بستن تنظیمات"
          >
            <FaTimes />
          </Button>
        </DialogHeader>
        <DialogPanel>
                <div aria-live="polite">
                  <section
                    className="settings-section"
                    aria-label="انتخاب حالت نمایش"
                  >
                    <h3 className="settings-section-title">حالت نمایش</h3>
                    <div className="settings-theme-grid">
                      {THEME_OPTIONS.map((option) => (
                        <Toggle
                          key={option.value}
                          variant="outline"
                          className="h-11 justify-start gap-3 px-4"
                          pressed={pendingTheme === option.value}
                          onPressedChange={() => setPendingTheme(option.value)}
                        >
                          {option.icon}
                          <span>{option.label}</span>
                        </Toggle>
                      ))}
                    </div>
                  </section>

                  <section
                    className="settings-section"
                    aria-label="شماره‌گذاری شعر"
                  >
                    <h3 className="settings-section-title">نمایش شماره بیت</h3>
                    <label className={`${toggleRowClass}`}>
                      <span>نمایش شماره بیت</span>
                      <Switch checked={pendingShowLineNumbers} onCheckedChange={setPendingShowLineNumbers} />
                    </label>
                  </section>

                  <section
                    className="settings-section"
                    aria-label="ترتیب نمایش شعرها"
                  >
                    <h3 className="settings-section-title">
                      ترتیب نمایش شعرها
                    </h3>
                    <label className={`${toggleRowClass}`}>
                      <span>پخش تصادفی شعرها</span>
                      <Switch checked={pendingRandomizePoems} onCheckedChange={setPendingRandomizePoems} />
                    </label>
                    <label className={`${toggleRowClass} mt-3`}>
                      <span>پرسش هنگام ورود به صفحه شاعر</span>
                      <Switch checked={pendingAskRandomizePoemsOnPoetPages} onCheckedChange={setPendingAskRandomizePoemsOnPoetPages} />
                    </label>
                  </section>

                  <section
                    className="settings-section"
                    aria-label="انتخاب قلم شعر"
                  >
                    <h3 className="settings-section-title">قلم شعر</h3>
                    <div className="settings-font-grid">
                      {FONT_CHOICES.map((font) => (
                        <Toggle
                          key={font.value}
                          variant="outline"
                          className="h-11 justify-start px-4 text-base"
                          style={{ fontFamily: FONT_STACKS[font.value] }}
                          pressed={pendingFontFamily === font.value}
                          onPressedChange={() => setPendingFontFamily(font.value)}
                        >
                          <span className="font-label">{font.label}</span>
                          {font.note && (
                            <span className="font-note">({font.note})</span>
                          )}
                        </Toggle>
                      ))}
                    </div>
                  </section>

                  <section
                    className="settings-section"
                    aria-label="اندازه امن قلم شعر"
                  >
                    <h3 className="settings-section-title">اندازه قلم شعر</h3>
                    <div
                      className="settings-size-control"
                      style={{ "--range-thumb-size": "1rem" } as React.CSSProperties}
                    >
                      <div className="settings-size-readout">
                        <span className="settings-size-value">
                          {formatPersianNumber(pendingPoemFontSize)}٪
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9"
                          onClick={() =>
                            setPendingPoemFontSize(DEFAULT_POEM_FONT_SIZE)
                          }
                          disabled={
                            pendingPoemFontSize === DEFAULT_POEM_FONT_SIZE
                          }
                        >
                          بازنشانی
                        </Button>
                      </div>
                      <div className="settings-size-track">
                        <Slider
                          min={POEM_FONT_SIZE_MIN}
                          max={POEM_FONT_SIZE_MAX}
                          step={POEM_FONT_SIZE_STEP}
                          value={[pendingPoemFontSize]}
                          onValueChange={(value) =>
                            setPendingPoemFontSize(
                              clampPoemFontSize(
                                Array.isArray(value) ? value[0] : value,
                              ),
                            )
                          }
                          aria-label="اندازه قلم شعر"
                        />
                      </div>
                      <div className="settings-size-scale" aria-hidden="true">
                        <span>{formatPersianNumber(POEM_FONT_SIZE_MIN)}٪</span>
                        <span
                          className={`settings-size-scale-default ${
                            pendingPoemFontSize === DEFAULT_POEM_FONT_SIZE
                              ? "active"
                              : ""
                          }`}
                          style={poemFontSizeDefaultMarkerStyle}
                        >
                          {formatPersianNumber(DEFAULT_POEM_FONT_SIZE)}٪
                        </span>
                        <span>{formatPersianNumber(POEM_FONT_SIZE_MAX)}٪</span>
                      </div>
                    </div>
                  </section>

                  <section
                    className="settings-section"
                    aria-label="اجزای نمایش شعر"
                  >
                    <h3 className="settings-section-title">نمایش اجزای شعر</h3>
                    <div className="settings-toggle-list">
                      {POEM_VIEWER_COMPONENT_OPTIONS.map((component) => (
                        <label key={component.key} className={`${toggleRowClass}`}>
                      <span>{component.label}</span>
                      <Switch checked={pendingVisibility[component.key]} onCheckedChange={() => handleVisibilityToggle(component.key)} />
                    </label>
                      ))}
                    </div>
                  </section>
                </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" className="h-11" onClick={handleCancel}>
            لغو
          </Button>
          <Button className="h-11" onClick={handleSave}>
            ذخیره
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};

export default SettingsDialog;
