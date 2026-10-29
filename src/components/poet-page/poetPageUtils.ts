import type { PoetProfileRow } from "@/components/PoetProfile";
import type { GanjoorCategory } from "@/types/ganjoor";

export interface LocalPoemSummary {
  id: number;
  title: string;
  collection?: string;
}

export interface LocalCollectionGroup {
  title: string;
  year: string | null;
  poems: LocalPoemSummary[];
}

/** Consecutive poems of the same book, in file order; years come from the dataset's `collections`. */
export const groupByCollection = (
  summaries: LocalPoemSummary[],
  meta: Array<{ title: string; year?: string }>,
): LocalCollectionGroup[] => {
  const groups: LocalCollectionGroup[] = [];
  summaries.forEach((summary) => {
    const title = summary.collection ?? "";
    const last = groups[groups.length - 1];
    if (last && last.title === title) {
      last.poems.push(summary);
    } else {
      groups.push({
        title,
        year: meta.find((entry) => entry.title === title)?.year ?? null,
        poems: [summary],
      });
    }
  });
  return groups;
};

const persianNumberFormatter = new Intl.NumberFormat("fa-IR");

export const formatPersianNumber = (value: number) =>
  persianNumberFormatter.format(value);

export const createPoemOrder = (ids: number[], randomize: boolean): number[] => {
  const uniqueIds = Array.from(
    new Set(ids.filter((id) => typeof id === "number" && id > 0)),
  );
  if (!randomize) {
    return uniqueIds;
  }
  const shuffled = [...uniqueIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

export const indexCategories = (
  root: GanjoorCategory,
): Record<number, GanjoorCategory> => {
  const map: Record<number, GanjoorCategory> = {};
  const traverse = (node: GanjoorCategory) => {
    map[node.id] = node;
    if (Array.isArray(node.children)) {
      node.children.forEach(traverse);
    }
  };
  traverse(root);
  return map;
};

export const buildCategoryRows = (
  categories: GanjoorCategory[],
  categoryCache: Record<number, GanjoorCategory>,
  selectedId: number | null,
  loadingId: number | null,
): PoetProfileRow[] =>
  categories.map((category) => {
    const cached = categoryCache[category.id] ?? category;
    const children =
      cached.children && cached.children.length > 0
        ? cached.children
        : category.children ?? [];
    return {
      id: category.id,
      title: category.title,
      count: cached.poems?.length ?? 0,
      isSelected: selectedId === category.id,
      isLoading: loadingId === category.id,
      children: buildCategoryRows(children, categoryCache, selectedId, loadingId),
    };
  });
