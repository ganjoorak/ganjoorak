"use client";

import type { RefObject } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Volume2, VolumeX } from "lucide-react";
import type { PoemRecitation } from "@/types/poem";
import { FONT_STACKS, type FontFamilyOption } from "@/context/SettingsContext";
import {
  SHARE_CARD_FORMATS,
  SHARE_CARD_THEMES,
  type ShareCardFormat,
  type ShareCardLayout,
  type ShareCardThemeId,
} from "@/components/share/shareCard";
import {
  LAYOUT_CHOICES,
  SHARE_FONT_CHOICES,
  faNumber,
  type ShareMode,
} from "@/components/share/shareDialog";
import { barSpring } from "@/components/share/shareMotion";
import { OptionTabs } from "@/components/share/OptionTabs";

export type DesignPanel = "type" | "voice" | null;

interface ShareDesignBarProps {
  mode: ShareMode;
  panel: DesignPanel;
  onPanelChange: (next: DesignPanel | ((open: DesignPanel) => DesignPanel)) => void;
  barRef: RefObject<HTMLDivElement>;
  themeId: ShareCardThemeId;
  onThemeChange: (id: ShareCardThemeId) => void;
  format: ShareCardFormat;
  onFormatChange: (key: ShareCardFormat) => void;
  cardLayout: ShareCardLayout;
  onCardLayoutChange: (next: ShareCardLayout) => void;
  fontFamily: FontFamilyOption;
  onFontFamilyChange: (next: FontFamilyOption) => void;
  fontStack: string;
  /** The recitations a video can carry, and which one is chosen (-1: silent). */
  recitations: PoemRecitation[];
  recitationIndex: number;
  onRecitationIndexChange: (index: number) => void;
}

/** Colour, size, type and voice choices for the card, under the preview. */
export default function ShareDesignBar({
  mode,
  panel,
  onPanelChange,
  barRef,
  themeId,
  onThemeChange,
  format,
  onFormatChange,
  cardLayout,
  onCardLayoutChange,
  fontFamily,
  onFontFamilyChange,
  fontStack,
  recitations,
  recitationIndex,
  onRecitationIndexChange,
}: ShareDesignBarProps) {
  return (
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
                  onChange={onCardLayoutChange}
                  options={LAYOUT_CHOICES}
                />
                <OptionTabs<FontFamilyOption>
                  label="قلم"
                  value={fontFamily}
                  onChange={onFontFamilyChange}
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
                      onRecitationIndexChange(item.value);
                      onPanelChange(null);
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
              onClick={() => onThemeChange(item.id)}
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
                onClick={() => onFormatChange(key)}
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
          onClick={() => onPanelChange((open) => (open === "type" ? null : "type"))}
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
            onClick={() => onPanelChange((open) => (open === "voice" ? null : "voice"))}
          >
            {recitationIndex >= 0 ? <Volume2 /> : <VolumeX />}
          </button>
        )}
      </div>
    </div>
  );
}
