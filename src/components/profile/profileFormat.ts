import type { Banner, BannerKey } from "@/utils/progressApi";

// Small formatting helpers shared by the profile components.

/** Same file the service's catalog points at (/banners/{key}.svg). */
export const bannerImage = (key: string) => `/banners/${key}.svg`;

/** Used by the appearance editor until (or unless) the catalog answers. */
export const FALLBACK_BANNERS: Banner[] = (
  [
    ["dawn", "سپیده‌دم"],
    ["dusk", "غروب"],
    ["night", "شب"],
    ["garden", "باغ"],
    ["desert", "کویر"],
    ["sea", "دریا"],
    ["tile", "کاشی"],
    ["paper", "کاغذ"],
  ] as [BannerKey, string][]
).map(([key, title]) => ({ key, title, image: bannerImage(key) }));

const relativeFormatter = new Intl.RelativeTimeFormat("fa", { numeric: "auto" });
const dateFormatter = new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium" });

export const formatDate = (timestamp: number) => dateFormatter.format(new Date(timestamp));

/** «۳ ساعت پیش», falling back to a plain date after a month. */
export const formatRelativeTime = (timestamp: number, now = Date.now()) => {
  const seconds = Math.round((timestamp - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "همین حالا";
  if (abs < 3600) return relativeFormatter.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return relativeFormatter.format(Math.round(seconds / 3600), "hour");
  if (abs < 86400 * 30) return relativeFormatter.format(Math.round(seconds / 86400), "day");
  return formatDate(timestamp);
};

const tehranDayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tehran",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today in Asia/Tehran as "YYYY-MM-DD", the day format of Streak.days. */
export const tehranDay = (date = new Date()) => tehranDayFormatter.format(date);

const dayLabelFormatter = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
  timeZone: "UTC",
  day: "numeric",
  month: "long",
});

/** The last `count` days ending at `today`, oldest first, with a Persian label each. */
export const lastDays = (today: string, count: number) => {
  const [year, month, day] = today.split("-").map(Number);
  const end = Date.UTC(year, month - 1, day);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(end - (count - 1 - index) * 86_400_000);
    return {
      day: date.toISOString().slice(0, 10),
      label: dayLabelFormatter.format(date),
    };
  });
};
