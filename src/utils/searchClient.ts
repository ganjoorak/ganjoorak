import type { DirectoryPoet } from "@/utils/poetDirectory";
import { getDirectoryPoetDisplayName } from "@/utils/poetDirectory";
import { LruCache } from "@/utils/searchCache";
import type { PoemHit } from "@/utils/searchMatch";
import { normalizeSearchText } from "@/utils/searchText";

/**
 * Browser side of search: thin, cached clients for `/api/search/local` and `/api/search/ganjoor`,
 * plus poet matching, which is synchronous because the poet directory ships with the bundle.
 */

export interface LocalSearchResponse {
  hits: PoemHit[];
  total: number;
  /** Matches per source before any source filter. */
  counts: Record<"custom" | "echolalia", number>;
}

export interface GanjoorSearchResponse {
  hits: PoemHit[];
  next: string | null;
  phraseTotal: number | null;
  wordsTotal: number | null;
}

const pending = new Map<string, Promise<unknown>>();
const resolved = new LruCache<unknown>(150);

/**
 * Requests are never aborted: responses are a few KB and a finished one is cached, so the query a
 * user backspaces to is already there. Callers drop stale results themselves.
 */
const getJson = <T,>(url: string): Promise<T> => {
  const done = resolved.get(url);
  if (done !== undefined) {
    return Promise.resolve(done as T);
  }
  const inflight = pending.get(url);
  if (inflight) {
    return inflight as Promise<T>;
  }
  const request = fetch(url, { headers: { Accept: "application/json" } })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Search request failed: ${response.status}`);
      }
      const data = (await response.json()) as T;
      resolved.set(url, data);
      return data;
    })
    .finally(() => pending.delete(url));
  pending.set(url, request);
  return request;
};

/** Synchronous peek, so cached queries render in the same frame as the keystroke. */
const peekJson = <T,>(url: string) => resolved.get(url) as T | undefined;

export const localSearchUrl = (
  term: string,
  { poet, source, limit = 30 }: { poet?: string | null; source?: "custom" | "echolalia" | null; limit?: number } = {},
) => {
  const params = new URLSearchParams({ q: term, limit: String(limit) });
  if (poet) params.set("poet", poet);
  if (source) params.set("source", source);
  return `/api/search/local?${params}`;
};

export const ganjoorSearchUrl = (
  term: string,
  { poetId, cursor }: { poetId?: number | null; cursor?: string | null } = {},
) => {
  const params = new URLSearchParams({ q: term });
  if (poetId) params.set("poetId", String(poetId));
  if (cursor) params.set("cursor", cursor);
  return `/api/search/ganjoor?${params}`;
};

export const fetchSearch = getJson;
export const peekSearch = peekJson;

interface PoetNames {
  poet: DirectoryPoet;
  names: string[];
}

const namesCache = new WeakMap<DirectoryPoet[], PoetNames[]>();

const poetNames = (directory: DirectoryPoet[]) => {
  let names = namesCache.get(directory);
  if (!names) {
    names = directory
      .filter((poet) => poet.published !== false)
      .map((poet) => ({
        poet,
        names: Array.from(
          new Set([poet.nickname, poet.name].filter(Boolean).map((name) => normalizeSearchText(name!))),
        ),
      }));
    namesCache.set(directory, names);
  }
  return names;
};

const nameScore = (name: string, query: string) => {
  if (name === query) return 100;
  if (name.startsWith(query)) return 80;
  if (name.split(" ").some((word) => word.startsWith(query))) return 65;
  if (query.length >= 3 && name.includes(query)) return 30;
  return 0;
};

/**
 * Poets whose name or pen name matches, best first: exact, then prefix, then word prefix; the
 * pinned classics («حافظ», «سعدی»…) win ties, then Ganjoor before Echolalia and local poets.
 */
export const matchPoets = (query: string, directory: DirectoryPoet[], limit = 8): DirectoryPoet[] => {
  const normalized = normalizeSearchText(query);
  if (normalized.length < 2) {
    return [];
  }
  return poetNames(directory)
    .map(({ poet, names }) => {
      const score = Math.max(...names.map((name) => nameScore(name, normalized)));
      if (score === 0) {
        return null;
      }
      const pin = poet.pinOrder > 0 ? 20 - Math.min(poet.pinOrder, 19) : 0;
      const sourceBonus = poet.source === "ganjoor" ? 2 : poet.source === "custom" ? 1 : 0;
      return { poet, score: score + pin + sourceBonus };
    })
    .filter((entry): entry is { poet: DirectoryPoet; score: number } => entry !== null)
    .sort(
      (left, right) =>
        right.score - left.score ||
        getDirectoryPoetDisplayName(left.poet).localeCompare(getDirectoryPoetDisplayName(right.poet), "fa"),
    )
    .slice(0, limit)
    .map((entry) => entry.poet);
};

export const getPoetHref = (poet: Pick<DirectoryPoet, "urlSlug">) => `/${poet.urlSlug}`;

/**
 * One list from both sources. The first Ganjoor page and the local hits are ordered together by
 * match quality (phrase/words in one line, whole words, title); within a level the two sources
 * alternate so neither buries the other. Later Ganjoor pages follow.
 */
export const mergeHits = (
  query: string,
  local: PoemHit[],
  ganjoor: PoemHit[],
  ganjoorFirstPage: number,
) => {
  const normalized = normalizeSearchText(query);
  const rank = (hit: PoemHit) =>
    hit.tier * 4 + (hit.whole ? 2 : 0) + (normalizeSearchText(hit.title).includes(normalized) ? 1 : 0);
  const levels = new Map<number, { ganjoor: PoemHit[]; local: PoemHit[] }>();
  const add = (hit: PoemHit, from: "ganjoor" | "local") => {
    const level = rank(hit);
    const bucket = levels.get(level) ?? { ganjoor: [], local: [] };
    bucket[from].push(hit);
    levels.set(level, bucket);
  };
  ganjoor.slice(0, ganjoorFirstPage).forEach((hit) => add(hit, "ganjoor"));
  local.forEach((hit) => add(hit, "local"));

  const head = Array.from(levels.entries())
    .sort(([left], [right]) => right - left)
    .flatMap(([, bucket]) => {
      const mixed: PoemHit[] = [];
      for (let index = 0; index < Math.max(bucket.ganjoor.length, bucket.local.length); index += 1) {
        if (bucket.ganjoor[index]) mixed.push(bucket.ganjoor[index]);
        if (bucket.local[index]) mixed.push(bucket.local[index]);
      }
      return mixed;
    });

  const seen = new Set<string>();
  return [...head, ...ganjoor.slice(ganjoorFirstPage)].filter((hit) => {
    if (seen.has(hit.key)) {
      return false;
    }
    seen.add(hit.key);
    return true;
  });
};
