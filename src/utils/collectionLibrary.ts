import { LIBRARY_CHANGE_EVENT } from "@/utils/poemLibrary";

/**
 * A poet's book the reader loves. Ganjoor books are categories (`categoryId`);
 * local ones (custom poets) are the `collection` title their poems carry.
 * Stored like the favorite poems and merged into the account by <AccountSync>;
 * the personal feed also draws poems from them.
 */
export interface CollectionEntry {
  key: string;
  source: "ganjoor" | "custom";
  /** Ganjoor category id; 0 for local books. */
  categoryId: number;
  poetSlug: string;
  poetName: string;
  title: string;
  /** The poet's page, the closest thing a book has to an address. */
  href: string;
  savedAt: number;
}

const COLLECTIONS_KEY = "ganjoorak:collections:v1";
const MAX_COLLECTIONS = 100;

export const buildCollectionKey = (
  source: CollectionEntry["source"],
  poetSlug: string,
  idOrTitle: number | string,
) => (source === "ganjoor" ? `ganjoor:${poetSlug}:cat:${idOrTitle}` : `custom:${poetSlug}:${idOrTitle}`);

const isEntry = (value: unknown): value is CollectionEntry =>
  Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as CollectionEntry).key === "string" &&
      typeof (value as CollectionEntry).title === "string" &&
      typeof (value as CollectionEntry).href === "string" &&
      typeof (value as CollectionEntry).categoryId === "number",
  );

export const readLovedCollections = (): CollectionEntry[] => {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COLLECTIONS_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
};

export const writeLovedCollections = (entries: CollectionEntry[]) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(entries.slice(0, MAX_COLLECTIONS)));
  window.dispatchEvent(new Event(LIBRARY_CHANGE_EVENT));
};

/** Returns whether the book is loved afterwards. */
export const toggleLovedCollection = (entry: Omit<CollectionEntry, "savedAt">) => {
  const current = readLovedCollections();
  if (current.some((item) => item.key === entry.key)) {
    writeLovedCollections(current.filter((item) => item.key !== entry.key));
    return false;
  }
  writeLovedCollections([{ ...entry, savedAt: Date.now() }, ...current]);
  return true;
};

export const removeLovedCollection = (key: string) =>
  writeLovedCollections(readLovedCollections().filter((item) => item.key !== key));
