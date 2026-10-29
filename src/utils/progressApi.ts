import { request } from "@/utils/accountApi";

// Reading streak, badges and the appearance catalog. Contract:
// docs/social-api-contract.md §1–3.

export interface Streak {
  /** Consecutive days ending today, or yesterday when today has no read yet. */
  current: number;
  best: number;
  /** Whether today already counts. */
  today: boolean;
  /** Distinct (poem, day) reads ever. */
  totalPoems: number;
  /** "YYYY-MM-DD" (Asia/Tehran) days with a read among the last 28, oldest first. */
  days: string[];
}

export type BadgeIcon = "sprout" | "flame" | "moon" | "star" | "crown";

export interface Badge {
  key: string;
  title: string;
  description: string;
  icon: BadgeIcon;
  tier: number;
  /** 0 in the catalog. */
  earnedAt: number;
}

export type BannerKey = "dawn" | "dusk" | "night" | "garden" | "desert" | "sea" | "tile" | "paper";

export interface Banner {
  key: BannerKey;
  title: string;
  /** Same-origin static file, e.g. /banners/dawn.svg. */
  image: string;
}

/** Report one real read (≥15 s visible, or reached the end). Signed in only. */
export const reportRead = (key: string) =>
  request<{ streak: Streak; newBadges: Badge[] }>("read", { method: "POST", json: { key } });

export const fetchCatalog = () => request<{ badges: Badge[]; banners: Banner[] }>("catalog");
