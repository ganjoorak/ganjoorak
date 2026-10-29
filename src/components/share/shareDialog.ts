import type { Poem } from "@/types/poem";
import type { FontFamilyOption } from "@/context/SettingsContext";
import type {
  ShareCardFormat,
  ShareCardLayout,
  ShareCardThemeId,
} from "@/components/share/shareCard";
import type { ShareVideoResult } from "@/components/share/shareVideo";

export type ShareMode = "image" | "video";
export type Step = "select" | "design";
export type ActionId = "copyText" | "copyLink" | "download" | "share";
export type Feedback = { action: ActionId; ok: boolean } | null;

export type VideoState =
  | { status: "idle" }
  | { status: "preparing"; label: string }
  | { status: "recording"; progress: number }
  | { status: "done"; result: ShareVideoResult; url: string }
  | { status: "error"; message: string };

export interface SharePrefs {
  theme?: ShareCardThemeId;
  format?: ShareCardFormat;
  layout?: ShareCardLayout;
  font?: FontFamilyOption;
}

const PREFS_KEY = "ganjoorak-share-prefs";
export const PREVIEW_SCALE = 0.75;

export const SHARE_FONT_CHOICES: Array<{ value: FontFamilyOption; label: string }> = [
  { value: "vazirmatn", label: "وزیرمتن" },
  { value: "samim", label: "صمیم" },
  { value: "gandom", label: "گندم" },
  { value: "parastoo", label: "پرستو" },
  { value: "sahel", label: "ساحل" },
];

export const LAYOUT_CHOICES: Array<{ value: ShareCardLayout; label: string }> = [
  { value: "single", label: "تک‌ستون" },
  { value: "couplet", label: "دوستون" },
];

export const faNumber = new Intl.NumberFormat("fa-IR");

export const readPrefs = (): SharePrefs => {
  try {
    return JSON.parse(window.localStorage.getItem(PREFS_KEY) || "{}");
  } catch {
    return {};
  }
};

export const writePrefs = (prefs: SharePrefs) => {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode: preferences just don't stick.
  }
};

export const buildPoemUrl = (poem: Poem, poetSlug?: string) => {
  const baseUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://ganjoorak.ir";

  if (poem.isCustom) {
    return `${baseUrl}/${poetSlug || poem.poetSlug}/${poem.id}`;
  }

  return `${baseUrl}/poem/${poem.id}`;
};

export const saveBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
};
