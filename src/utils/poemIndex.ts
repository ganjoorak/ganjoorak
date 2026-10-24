import ganjoorApi from "@/api/GanjoorApi";
import type { Poem } from "@/types/poem";
import { logger } from "@/utils/logger";

// Ganjoor's /poem/random only covers a fixed list of ~18 poets (and ignores poetId
// for everyone else), so random picks come from our own index of every poem ID,
// built by scripts/build-poem-index.mjs.

interface IndexedPoet {
  id: number;
  slug: string;
  count: number;
  /** Flattened [start, length] runs of poem IDs. */
  runs: number[];
}

interface PoemIndex {
  poets: IndexedPoet[];
  totalCount: number;
  byId: Map<number, IndexedPoet>;
}

const MAX_ATTEMPTS = 3;

let indexLoad: Promise<PoemIndex> | null = null;

const loadPoemIndex = (): Promise<PoemIndex> => {
  if (!indexLoad) {
    indexLoad = fetch("/data/poem-index.json")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ poets: IndexedPoet[] }>;
      })
      .then(({ poets }) => ({
        poets,
        totalCount: poets.reduce((sum, poet) => sum + poet.count, 0),
        byId: new Map(poets.map((poet) => [poet.id, poet])),
      }))
      .catch((error) => {
        indexLoad = null;
        throw error;
      });
  }
  return indexLoad;
};

const randomInt = (max: number) => Math.floor(Math.random() * max);

const poemIdAt = (poet: IndexedPoet, offset: number) => {
  let remaining = offset;
  for (let i = 0; i < poet.runs.length; i += 2) {
    const length = poet.runs[i + 1];
    if (remaining < length) return poet.runs[i] + remaining;
    remaining -= length;
  }
  return poet.runs[0];
};

/** A poet weighted by how many poems they have, so every poem is equally likely. */
const pickWeightedPoet = (index: PoemIndex) => {
  let target = randomInt(index.totalCount);
  for (const poet of index.poets) {
    if (target < poet.count) return poet;
    target -= poet.count;
  }
  return index.poets[index.poets.length - 1];
};

const fetchFirstAvailable = async (pickId: () => number): Promise<Poem> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      return await ganjoorApi.getPoemById(pickId());
    } catch (error) {
      // An indexed poem can since have been removed or merged; try another.
      lastError = error;
    }
  }
  throw lastError;
};

/** Any Ganjoor poem, uniformly across the whole corpus. */
export const fetchRandomGanjoorPoem = async (): Promise<Poem> => {
  let index: PoemIndex;
  try {
    index = await loadPoemIndex();
  } catch (error) {
    logger.error("Poem index unavailable, using Ganjoor's random:", error);
    return ganjoorApi.getPoemById((await ganjoorApi.getRandomPoem()).id);
  }

  return fetchFirstAvailable(() => {
    const poet = pickWeightedPoet(index);
    return poemIdAt(poet, randomInt(poet.count));
  });
};

/** A poem by one Ganjoor poet, uniformly across all their works. */
export const fetchRandomPoemByPoetId = async (poetId: number): Promise<Poem> => {
  const poet = await loadPoemIndex()
    .then((index) => index.byId.get(poetId))
    .catch((error) => {
      logger.error("Poem index unavailable:", error);
      return undefined;
    });

  if (!poet) {
    return ganjoorApi.getPoemById((await ganjoorApi.getRandomPoemByPoetId(poetId)).id);
  }

  return fetchFirstAvailable(() => poemIdAt(poet, randomInt(poet.count)));
};
