// WCAG contrast helpers for profile colours. The same rule the accounts service
// applies when saving (backend/appearance.go): accent on background needs ≥ 3.

export const MIN_ACCENT_CONTRAST = 3;
export const LOW_CONTRAST_MESSAGE = "رنگ تأکید روی این پس‌زمینه دیده نمی‌شود؛ رنگ دیگری انتخاب کنید.";

const HEX_PATTERN = /^#[0-9a-f]{6}$/i;

export const isHexColor = (value: string) => HEX_PATTERN.test(value);

/** "#rrggbb" to [r, g, b] (0-255), or null when it isn't a full hex colour. */
export const parseHex = (hex: string): [number, number, number] | null => {
  if (!isHexColor(hex)) {
    return null;
  }
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)) as [number, number, number];
};

/** WCAG relative luminance, 0 (black) to 1 (white). */
export const luminance = (hex: string): number => {
  const rgb = parseHex(hex);
  if (!rgb) {
    return 0;
  }
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG contrast ratio, 1 to 21. */
export const contrastRatio = (a: string, b: string): number => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

/** Black or white, whichever reads better on `background`. */
export const readableTextOn = (background: string): "#000000" | "#ffffff" =>
  contrastRatio("#000000", background) >= contrastRatio("#ffffff", background) ? "#000000" : "#ffffff";

/** True when the pair is allowed (or either colour is unset). */
export const hasEnoughContrast = (accent: string, background: string) =>
  !accent || !background || contrastRatio(accent, background) >= MIN_ACCENT_CONTRAST;

/** Blend `from` towards `to` by `amount` (0-1), as "#rrggbb". */
export const mixHex = (from: string, to: string, amount: number): string => {
  const a = parseHex(from);
  const b = parseHex(to);
  if (!a || !b) {
    return from;
  }
  const channels = a.map((value, index) => Math.round(value + (b[index] - value) * amount));
  return `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
};

/** "#rrggbb" to "r g b", the form the app's colour tokens use (rgb(var(--x))). */
export const hexToTriplet = (hex: string): string => (parseHex(hex) ?? [0, 0, 0]).join(" ");
