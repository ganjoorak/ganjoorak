// Server-only: Ganjoor full-text search, made usable.
//
// api.ganjoor.net returns whole poems (plain + HTML text, 250–600 KB per page of 20) in poet-
// chronological order, so a common word lists Rudaki and Ferdowsi before any real match. Here we
//   - ask for the exact phrase first (Ganjoor honours "…"), then for all the words,
//   - rerank each page by where the match sits (phrase in one hemistich > all words in one > spread),
//   - send the browser only the matching couplet (a few KB),
//   - and keep responses in memory so repeated queries and «more results» are instant.

import { getGanjoorUpstreamOrigin } from "@/server/ganjoorUpstream";
import { getIndexedPoetImageUrl } from "@/utils/poetImages";
import {
  bestLine,
  contextFor,
  trimAround,
  type PoemHit,
  type SearchQuery,
} from "@/utils/searchMatch";
import { normalizeSearchText } from "@/utils/searchText";

export const GANJOOR_PAGE_SIZE = 20;
const TIMEOUT_MS = 15000;
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 400;

type Stage = "phrase" | "words";

interface UpstreamPage {
  hits: PoemHit[];
  total: number;
  hasNext: boolean;
}

const cache = new Map<string, { at: number; page: Promise<UpstreamPage> }>();

const decodeEntities = (value: string) =>
  value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&nbsp;/g, " ")
    .replace(/&zwnj;/g, "\u200c")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/**
 * Hemistichs from the poem HTML, each tagged with its div class (m1/m2 for the two halves of a
 * couplet). plainText would be simpler but it starts with the title and loses the pairing.
 */
const verseLines = (poem: any): { lines: string[]; roles: string[] } => {
  const html = String(poem?.htmlText ?? "");
  const lines: string[] = [];
  const roles: string[] = [];
  const paragraph = /<p[^>]*>([\s\S]*?)<\/p>/g;
  let found: RegExpExecArray | null;
  while ((found = paragraph.exec(html))) {
    const text = decodeEntities(found[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    if (!text) {
      continue;
    }
    const classAt = html.lastIndexOf('class="', found.index);
    const role = classAt >= 0 ? html.slice(classAt + 7, html.indexOf('"', classAt + 7)) : "";
    lines.push(text);
    roles.push(role);
  }
  if (lines.length > 0) {
    return { lines, roles };
  }
  const plain = String(poem?.plainText ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return { lines: plain, roles: plain.map(() => "") };
};

const coupletContext = (
  lines: string[],
  roles: string[],
  index: number,
): Pick<PoemHit, "context" | "contextPosition"> => {
  if (roles[index] === "m1" && roles[index + 1] === "m2") {
    return { context: lines[index + 1], contextPosition: "after" };
  }
  if (roles[index] === "m2" && roles[index - 1] === "m1") {
    return { context: lines[index - 1], contextPosition: "before" };
  }
  return contextFor(lines, index);
};

const toHit = (poem: any, query: SearchQuery): PoemHit => {
  const fullTitle: string = poem?.fullTitle ?? "";
  const fullUrl: string = poem?.fullUrl ?? "";
  const parts = fullTitle.split(" » ").map((part) => part.trim()).filter(Boolean);
  const poetSlug = fullUrl.split("/").filter(Boolean)[0] ?? "";
  const { lines, roles } = verseLines(poem);
  const match = bestLine(lines.map(normalizeSearchText), query);
  const index = match?.index ?? 0;
  const { context, contextPosition } = coupletContext(lines, roles, index);

  return {
    key: `ganjoor:${poem?.id}`,
    id: poem?.id ?? 0,
    title: poem?.title || parts[parts.length - 1] || "",
    poetName: parts[0] ?? "",
    poetSlug,
    source: "ganjoor",
    href: `/poem/${poem?.id}`,
    collection: parts.length > 2 ? parts.slice(1, -1).join(" › ") : null,
    avatarUrl: getIndexedPoetImageUrl("ganjoor", poetSlug),
    line: trimAround(lines[index] ?? poem?.poemSummary ?? "", query),
    context: context ? trimAround(context, query) : null,
    contextPosition,
    tier: match?.tier ?? 1,
    whole: match?.whole ?? false,
  };
};

const rank = (hit: PoemHit) => hit.tier * 2 + (hit.whole ? 1 : 0);

const fetchUpstream = (
  query: SearchQuery,
  stage: Stage,
  page: number,
  poetId: number | null,
): Promise<UpstreamPage> => {
  const term = stage === "phrase" ? `"${query.normalized}"` : query.normalized;
  const url = new URL("/api/ganjoor/poems/search", getGanjoorUpstreamOrigin());
  url.searchParams.set("term", term);
  url.searchParams.set("PageNumber", String(page));
  url.searchParams.set("PageSize", String(GANJOOR_PAGE_SIZE));
  if (poetId) {
    url.searchParams.set("poetId", String(poetId));
  }

  const key = url.toString();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.page;
  }

  const request = fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Ganjoor search ${response.status}`);
    }
    const items = (await response.json()) as unknown;
    let paging: { totalCount?: number; hasNextPage?: boolean } = {};
    try {
      paging = JSON.parse(response.headers.get("paging-headers") ?? "{}");
    } catch {
      // Missing header: fall back to «a full page means there may be more».
    }
    const hits = (Array.isArray(items) ? items : []).map((poem) => toHit(poem, query));
    // Stable sort: Ganjoor's order breaks ties.
    hits.sort((left, right) => rank(right) - rank(left));
    return {
      hits,
      total: paging.totalCount ?? hits.length,
      hasNext: paging.hasNextPage ?? hits.length === GANJOOR_PAGE_SIZE,
    };
  });

  cache.set(key, { at: Date.now(), page: request });
  request.catch(() => cache.delete(key));
  while (cache.size > CACHE_MAX) {
    cache.delete(cache.keys().next().value!);
  }
  return request;
};

export interface GanjoorSearchResult {
  hits: PoemHit[];
  /** Opaque cursor for the next page, or null at the end. */
  next: string | null;
  phraseTotal: number | null;
  wordsTotal: number | null;
}

/**
 * Cursor `p:N` walks the exact-phrase results, then `w:N` the all-words results (skipping poems the
 * phrase stage already returned). Single-word queries only have the words stage.
 */
export const searchGanjoor = async (
  query: SearchQuery,
  { cursor, poetId }: { cursor: string | null; poetId: number | null },
): Promise<GanjoorSearchResult> => {
  const [stageCode, pageText] = (cursor ?? "").split(":");
  const usePhrase = query.isPhrase;
  let stage: Stage = stageCode === "w" || !usePhrase ? "words" : "phrase";
  const page = Math.max(1, Number(pageText) || 1);

  if (stage === "phrase") {
    // Start the words stage in parallel on the first page: it is needed whenever the phrase is rare.
    const wordsFirst = page === 1 ? fetchUpstream(query, "words", 1, poetId) : null;
    wordsFirst?.catch(() => undefined);
    const phrase = await fetchUpstream(query, "phrase", page, poetId);
    if (phrase.hasNext) {
      return { hits: phrase.hits, next: `p:${page + 1}`, phraseTotal: phrase.total, wordsTotal: null };
    }
    const words = await (wordsFirst ?? fetchUpstream(query, "words", 1, poetId)).catch(() => null);
    if (!words) {
      return { hits: phrase.hits, next: null, phraseTotal: phrase.total, wordsTotal: null };
    }
    const seen = new Set(phrase.hits.map((hit) => hit.id));
    return {
      hits: [...phrase.hits, ...words.hits.filter((hit) => !seen.has(hit.id))],
      next: words.hasNext ? "w:2" : null,
      phraseTotal: phrase.total,
      wordsTotal: words.total,
    };
  }

  stage = "words";
  const words = await fetchUpstream(query, stage, page, poetId);
  return {
    hits: words.hits,
    next: words.hasNext ? `w:${page + 1}` : null,
    phraseTotal: null,
    wordsTotal: words.total,
  };
};
