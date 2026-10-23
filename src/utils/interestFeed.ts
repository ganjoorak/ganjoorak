import ganjoorApi from "@/api/GanjoorApi";
import { getInterestByKey } from "@/data/interests";
import type { Poem } from "@/types/poem";

interface PoolEntry {
  poemId: number;
  poetSlug: string;
}

interface InterestPool {
  pending: PoolEntry[];
  lastPoetSlug: string | null;
}

const pools = new Map<string, InterestPool>();
const entryLoads = new Map<string, Promise<PoolEntry[]>>();

const getPool = (key: string): InterestPool => {
  const existing = pools.get(key);
  if (existing) {
    return existing;
  }

  const created: InterestPool = { pending: [], lastPoetSlug: null };
  pools.set(key, created);
  return created;
};

const shuffle = <T>(items: T[]): T[] => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

const fetchJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }
  return response.json();
};

const loadEntries = (key: string) => {
  const existing = entryLoads.get(key);
  if (existing) {
    return existing;
  }

  const load = fetchJson(`/data/interests/${key}.json`).then((data) => {
    const { poemIds, poetSlugs } = (data ?? {}) as {
      poemIds?: unknown;
      poetSlugs?: unknown;
    };
    if (!Array.isArray(poemIds)) {
      throw new Error(`Malformed interest file: ${key}`);
    }
    return poemIds
      .map((poemId, index) => ({
        poemId: Number(poemId),
        poetSlug: Array.isArray(poetSlugs) ? String(poetSlugs[index] ?? "") : "",
      }))
      .filter((entry) => Number.isInteger(entry.poemId) && entry.poemId > 0);
  });
  // Forget failed loads so the next request retries instead of reusing the rejection.
  load.catch(() => entryLoads.delete(key));
  entryLoads.set(key, load);
  return load;
};

const takeEntry = (pool: InterestPool, preferredPoetSlugs: Set<string>) => {
  const differentPoet = (entry: PoolEntry) =>
    !pool.lastPoetSlug || entry.poetSlug !== pool.lastPoetSlug;

  const order = [
    (entry: PoolEntry) =>
      preferredPoetSlugs.has(entry.poetSlug) && differentPoet(entry),
    differentPoet,
    () => true,
  ];

  for (const matches of order) {
    const index = pool.pending.findIndex(matches);
    if (index >= 0) {
      return pool.pending.splice(index, 1)[0];
    }
  }

  return undefined;
};

export const fetchInterestPoem = async (
  interestKey: string,
  preferredPoetSlugs: string[] = [],
): Promise<Poem> => {
  if (!getInterestByKey(interestKey)) {
    throw new Error(`Unknown interest: ${interestKey}`);
  }

  const entries = await loadEntries(interestKey);
  const pool = getPool(interestKey);

  // Once every poem was served, start a fresh shuffled round.
  if (pool.pending.length === 0) {
    pool.pending = shuffle(entries);
  }

  const entry = takeEntry(pool, new Set(preferredPoetSlugs));
  if (!entry) {
    throw new Error(`No poems available for interest: ${interestKey}`);
  }

  pool.lastPoetSlug = entry.poetSlug || null;
  return ganjoorApi.getPoemById(entry.poemId);
};

export const primeInterestPool = (interestKey: string) => {
  if (getInterestByKey(interestKey)) {
    loadEntries(interestKey).catch(() => undefined);
  }
};
