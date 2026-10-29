import { isHexColor } from "@/utils/colorContrast";
import type { StoryPerson } from "@/utils/quotesApi";

// Per-device story state: the newest quote id seen for each username, in localStorage.

const SEEN_KEY = "ganjoorak:stories-seen:v1";

export type SeenMap = Record<string, number>;

export const readSeen = (): SeenMap => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number",
      ),
    );
  } catch {
    return {};
  }
};

const writeSeen = (seen: SeenMap) => {
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // Private mode or a full disk: the ring just stays unseen next time.
  }
};

/** Quotes are numbered upwards, so the newest has the highest id. */
export const newestQuoteId = (person: StoryPerson) => person.quotes.reduce((max, quote) => Math.max(max, quote.id), 0);

export const isPersonSeen = (person: StoryPerson, seen: SeenMap) =>
  (seen[person.user.username] ?? 0) >= newestQuoteId(person);

/** Remembers that `quoteId` of `username` was shown; returns the new map. Never goes backwards. */
export const markSeen = (username: string, quoteId: number): SeenMap => {
  const seen = readSeen();
  if ((seen[username] ?? 0) >= quoteId) return seen;
  const next = { ...seen, [username]: quoteId };
  writeSeen(next);
  return next;
};

/** Index of the first quote (oldest first) newer than the last one seen on this device; 0 when all are seen. */
export const firstUnseenIndex = (person: StoryPerson) => {
  const seenId = readSeen()[person.user.username] ?? 0;
  const index = [...person.quotes].sort((a, b) => a.id - b.id).findIndex((quote) => quote.id > seenId);
  return index === -1 ? 0 : index;
};

/** The person's accent as a CSS colour, or null to use the app's own. */
export const personAccent = (person: StoryPerson) => (isHexColor(person.user.accent) ? person.user.accent : null);

const relative = new Intl.RelativeTimeFormat("fa", { numeric: "auto" });

/** «همین الان», «۵ دقیقه پیش», «دیروز»… */
export const formatStoryTime = (timestamp: number, now = Date.now()) => {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 45) return "همین الان";
  if (seconds < 3600) return relative.format(-Math.round(seconds / 60), "minute");
  if (seconds < 86_400) return relative.format(-Math.round(seconds / 3600), "hour");
  return relative.format(-Math.round(seconds / 86_400), "day");
};
