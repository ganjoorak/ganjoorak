import ganjoorApi from "@/api/GanjoorApi";
import type { Poem } from "@/types/poem";
import { readFavorites } from "@/utils/poemLibrary";

let neighboursLoad: Promise<Record<string, number[]>> | null = null;

const fetchJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }
  return response.json();
};

const loadNeighbours = () => {
  if (!neighboursLoad) {
    neighboursLoad = fetchJson("/data/neighbours.json").then((data) => {
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("Malformed neighbours file");
      }
      return data as Record<string, number[]>;
    });
    neighboursLoad.catch(() => {
      neighboursLoad = null;
    });
  }
  return neighboursLoad;
};

// shortcut: neighbours exist only for interest-category poems, so favorites saved from
// elsewhere add nothing; precompute for all poems (larger file) if that matters.
export const fetchSimilarPoem = async (): Promise<Poem | null> => {
  const favoriteIds = new Set(
    readFavorites()
      .filter((entry) => entry.source === "ganjoor")
      .map((entry) => entry.id),
  );
  if (favoriteIds.size === 0) {
    return null;
  }

  const neighbours = await loadNeighbours();
  const candidates = Array.from(favoriteIds)
    .flatMap((id) => (Array.isArray(neighbours[id]) ? neighbours[id] : []))
    .filter((id) => Number.isInteger(id) && id > 0 && !favoriteIds.has(id));
  if (candidates.length === 0) {
    return null;
  }

  return ganjoorApi.getPoemById(
    candidates[Math.floor(Math.random() * candidates.length)],
  );
};
