import ganjoorApi from "@/api/GanjoorApi";
import customApi from "@/api/CustomApi";
import { isValidPoetSlug } from "@/types/poet";
import type { Poem } from "@/types/poem";
import type { GanjoorCategory } from "@/types/ganjoor";
import type { CollectionEntry } from "@/utils/collectionLibrary";

// Sub-books are walked, not flattened: a Ganjoor book can hold thousands of poems
// spread over nested categories, and the API has no "random poem of a category".
const MAX_DEPTH = 6;
const categoryCache = new Map<number, Promise<GanjoorCategory>>();

const loadCategory = (id: number) => {
  let cached = categoryCache.get(id);
  if (!cached) {
    cached = ganjoorApi.getCategoryWithPoems(id);
    // A failed load must not be remembered.
    cached.catch(() => categoryCache.delete(id));
    categoryCache.set(id, cached);
  }
  return cached;
};

const randomPoemIdInCategory = async (id: number, depth = 0): Promise<number> => {
  const category = await loadCategory(id);
  const children = category.children ?? [];
  const poems = category.poems ?? [];
  // Each sub-category counts once, and the category's own poems count once together.
  const slots = children.length + (poems.length > 0 ? 1 : 0);
  if (slots === 0) {
    throw new Error(`Category ${id} has no poems`);
  }
  const slot = Math.floor(Math.random() * slots);
  if (slot < children.length && depth < MAX_DEPTH) {
    return randomPoemIdInCategory(children[slot].id, depth + 1);
  }
  if (poems.length === 0) {
    throw new Error(`Category ${id} is too deep`);
  }
  return poems[Math.floor(Math.random() * poems.length)].id;
};

/** One random poem of a loved book, for the personal feed. */
export const fetchRandomPoemFromCollection = async (entry: CollectionEntry): Promise<Poem> => {
  if (entry.source === "custom") {
    if (!isValidPoetSlug(entry.poetSlug)) {
      throw new Error(`Unsupported custom poet: ${entry.poetSlug}`);
    }
    return customApi.getRandomPoemFromCollection(entry.poetSlug, entry.title);
  }
  return ganjoorApi.getPoemById(await randomPoemIdInCategory(entry.categoryId));
};
