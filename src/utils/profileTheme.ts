import type { CSSProperties } from "react";
import { hexToTriplet, isHexColor, mixHex, readableTextOn } from "@/utils/colorContrast";

// A profile's accent and background are scoped to the profile page root as CSS
// custom properties. Besides the --profile-* ones, the app's own colour tokens
// (--background, --primary, ...) are overridden in the same place, so every
// existing component inside picks the colours up, in any app theme: a light
// profile background keeps dark text in dark mode, and the other way round.

type ProfileThemeVars = CSSProperties & Record<`--${string}`, string>;

export const hasProfileColors = (accent: string, background: string) =>
  isHexColor(accent) || isHexColor(background);

/** Inline style for the profile root; undefined when neither colour is set. */
export const profileThemeStyle = (accent: string, background: string): CSSProperties | undefined => {
  const hasAccent = isHexColor(accent);
  const hasBackground = isHexColor(background);
  if (!hasAccent && !hasBackground) {
    return undefined;
  }
  const style: ProfileThemeVars = {};

  if (hasBackground) {
    const ink = readableTextOn(background);
    style["--profile-bg"] = background;
    style["--profile-fg"] = ink;
    style["--background"] = hexToTriplet(background);
    style["--foreground"] = hexToTriplet(ink);
    style["--card"] = hexToTriplet(mixHex(background, ink, 0.05));
    style["--card-foreground"] = hexToTriplet(ink);
    style["--muted"] = hexToTriplet(mixHex(background, ink, 0.09));
    style["--muted-foreground"] = hexToTriplet(mixHex(ink, background, 0.38));
    style["--secondary"] = hexToTriplet(mixHex(background, ink, 0.09));
    style["--secondary-foreground"] = hexToTriplet(ink);
    style["--border"] = hexToTriplet(mixHex(background, ink, 0.15));
    style["--input"] = hexToTriplet(mixHex(background, ink, 0.15));
    style["--primary"] = hexToTriplet(ink);
    style["--primary-foreground"] = hexToTriplet(background);
    style["--ring"] = hexToTriplet(ink);
    style.colorScheme = ink === "#000000" ? "light" : "dark";
  }

  if (hasAccent) {
    const onAccent = readableTextOn(accent);
    style["--profile-accent"] = accent;
    style["--profile-accent-fg"] = onAccent;
    style["--primary"] = hexToTriplet(accent);
    style["--primary-foreground"] = hexToTriplet(onAccent);
    style["--ring"] = hexToTriplet(accent);
  }

  return style;
};
