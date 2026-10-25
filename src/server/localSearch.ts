// Server-only: instant search over everything we hold locally — the Echolalia mirror (data/echolalia,
// via echolaliaStore) and the bundled poets in public/poems. Built once per process, then each query
// is a scan over pre-normalized text (~2k poems), which takes a few milliseconds.

import { readFile } from "node:fs/promises";
import path from "node:path";
import poetSourceIndex from "@/data/poet-source-index.json";
import { getPosts } from "@/lib/echolaliaStore";
import { PoetSlug, poetNames } from "@/types/poet";
import {
  bestLine,
  containsAllWords,
  findWordStart,
  contextFor,
  trimAround,
  type PoemHit,
  type SearchQuery,
} from "@/utils/searchMatch";
import { normalizeSearchText } from "@/utils/searchText";

interface IndexedPoem {
  base: Omit<PoemHit, "line" | "context" | "contextPosition" | "tier" | "whole">;
  lines: string[];
  normalizedLines: string[];
  normalizedTitle: string;
  normalizedText: string;
}

interface IndexEntry {
  source: "ganjoor" | "echolalia";
  id: number;
  name: string;
  localImageUrl?: string;
}

const decodeEntities = (value: string) =>
  value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&zwnj;/g, "‌")
    .replace(/&hellip;/g, "…")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

// Same line breaking as EcholaliaApi's htmlToPlainText, so snippets match the poem page.
const htmlToLines = (html: string) =>
  decodeEntities(
    html
      .replace(/<div\s+class=["']sing-block["'][\s\S]*$/i, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

const indexPoem = (
  base: IndexedPoem["base"],
  lines: string[],
): IndexedPoem => {
  const normalizedLines = lines.map(normalizeSearchText);
  return {
    base,
    lines,
    normalizedLines,
    normalizedTitle: normalizeSearchText(base.title),
    normalizedText: normalizedLines.join(" "),
  };
};

const buildEcholalia = async (): Promise<IndexedPoem[]> => {
  const poetsByCategory = new Map<number, { slug: string; name: string; image: string | null }>();
  Object.entries(poetSourceIndex.sourcesBySlug as Record<string, IndexEntry>).forEach(([slug, entry]) => {
    if (entry?.source === "echolalia" && entry.id) {
      poetsByCategory.set(entry.id, { slug, name: entry.name, image: entry.localImageUrl ?? null });
    }
  });

  const posts = await getPosts();
  return posts.flatMap((post) => {
    const poet = post.categories.map((id) => poetsByCategory.get(id)).find(Boolean);
    if (!poet) {
      return [];
    }
    const title = decodeEntities(post.title.rendered.replace(/<[^>]+>/g, "")).trim();
    return [
      indexPoem(
        {
          key: `echolalia:${poet.slug}:${post.id}`,
          id: post.id,
          title,
          poetName: poet.name,
          poetSlug: poet.slug,
          source: "echolalia",
          href: `/${poet.slug}/${post.id}`,
          collection: null,
          avatarUrl: poet.image,
        },
        htmlToLines(post.content.rendered),
      ),
    ];
  });
};

const buildCustom = async (): Promise<IndexedPoem[]> => {
  const perPoet = await Promise.all(
    Object.values(PoetSlug).map(async (slug) => {
      try {
        const raw = await readFile(path.join(process.cwd(), "public", "poems", `${slug}.json`), "utf8");
        const data = JSON.parse(raw) as { poet?: string; poems?: Array<{ id: number; title?: string; text?: string; collection?: string }> };
        const poetName = data.poet || poetNames[slug];
        return (data.poems ?? []).flatMap((poem) =>
          typeof poem?.id === "number"
            ? [
                indexPoem(
                  {
                    key: `custom:${slug}:${poem.id}`,
                    id: poem.id,
                    title: poem.title || `شعر ${poem.id}`,
                    poetName,
                    poetSlug: slug,
                    source: "custom",
                    href: `/${slug}/${poem.id}`,
                    collection: poem.collection?.trim() || null,
                    avatarUrl: `/images/poets/${slug}.jpeg`,
                  },
                  String(poem.text ?? "")
                    .split(/\r?\n/)
                    .map((line) => line.trim())
                    .filter(Boolean),
                ),
              ]
            : [],
        );
      } catch {
        return [];
      }
    }),
  );
  return perPoet.flat();
};

let indexLoad: Promise<IndexedPoem[]> | null = null;

const loadIndex = () => {
  indexLoad ??= Promise.all([buildCustom(), buildEcholalia()])
    .then(([custom, echolalia]) => [...custom, ...echolalia])
    .catch((error) => {
      indexLoad = null;
      throw error;
    });
  return indexLoad;
};

export const searchLocal = async (
  query: SearchQuery,
  { poetSlug, source, limit, offset }: {
    poetSlug?: string | null;
    source?: "custom" | "echolalia" | null;
    limit: number;
    offset: number;
  },
): Promise<{ hits: PoemHit[]; total: number; counts: Record<"custom" | "echolalia", number> }> => {
  const counts = { custom: 0, echolalia: 0 };
  if (!query.normalized) {
    return { hits: [], total: 0, counts };
  }
  const poems = await loadIndex();
  const scored: Array<{ poem: IndexedPoem; score: number; index: number; tier: number; whole: boolean }> = [];

  for (const poem of poems) {
    if (poetSlug && poem.base.poetSlug !== poetSlug) {
      continue;
    }
    const inTitle = containsAllWords(poem.normalizedTitle, query);
    if (!inTitle && !containsAllWords(poem.normalizedText, query)) {
      continue;
    }
    // Counted before the source filter so the UI can label every source tab.
    counts[poem.base.source as "custom" | "echolalia"] += 1;
    if (source && poem.base.source !== source) {
      continue;
    }
    const match = bestLine(poem.normalizedLines, query);
    const tier = match?.tier ?? (inTitle ? 2 : 1);
    const titleBonus =
      poem.normalizedTitle === query.normalized ? 4 : findWordStart(poem.normalizedTitle, query.normalized) >= 0 ? 2 : inTitle ? 1 : 0;
    const score = tier * 10 + (match?.whole ? 3 : 0) + titleBonus;
    scored.push({ poem, score, index: match?.index ?? 0, tier, whole: match?.whole ?? false });
  }

  // Stable: equal scores keep custom poets first, then Echolalia newest-first.
  scored.sort((left, right) => right.score - left.score);

  return {
    total: scored.length,
    counts,
    hits: scored.slice(offset, offset + limit).map(({ poem, index, tier, whole }) => ({
      ...poem.base,
      tier,
      whole,
      line: trimAround(poem.lines[index] ?? "", query),
      ...(() => {
        const { context, contextPosition } = contextFor(poem.lines, index);
        return { context: context ? trimAround(context, query) : null, contextPosition };
      })(),
    })),
  };
};
