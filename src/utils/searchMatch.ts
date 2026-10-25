import type { PoemLibrarySource } from "@/utils/poemLibrary";
import { normalizeSearchText } from "@/utils/searchText";

/**
 * Shared by the search API routes (server) and the search UI (client): one
 * way to split a query, score a poem and cut a snippet, so hits from the local
 * mirror and from Ganjoor rank on the same scale and can be merged.
 */

/** One result row, already trimmed to what the UI renders. */
export interface PoemHit {
  key: string;
  id: number;
  title: string;
  poetName: string;
  poetSlug: string;
  source: PoemLibrarySource;
  href: string;
  collection: string | null;
  avatarUrl: string | null;
  /** The best-matching line (hemistich), trimmed around the match if long. */
  line: string;
  /** The other half of the couplet (or the neighbouring line). */
  context: string | null;
  contextPosition: "before" | "after" | null;
  /** 3: the whole phrase in one line, 2: every word in one line, 1: words spread over the poem. */
  tier: number;
  /** The match is on whole words, not just word starts. */
  whole: boolean;
}

export interface SearchQuery {
  normalized: string;
  words: string[];
  isPhrase: boolean;
}

export const parseQuery = (value: string): SearchQuery => {
  const normalized = normalizeSearchText(value);
  const parts = normalized.split(" ").filter(Boolean);
  // One-letter words («و», «به» stays) are noise unless they are all there is.
  const words = parts.filter((word) => word.length > 1);
  return {
    normalized,
    words: words.length > 0 ? words : parts,
    isPhrase: parts.length > 1,
  };
};

const SNIPPET_MAX = 150;

/** Keeps long prose lines readable: a window around the first match. */
export const trimAround = (line: string, query: SearchQuery) => {
  if (line.length <= SNIPPET_MAX) {
    return line;
  }
  const normalizedLine = normalizeSearchText(line);
  const needle = query.isPhrase && normalizedLine.includes(query.normalized)
    ? query.normalized
    : query.words.find((word) => findWordStart(normalizedLine, word) >= 0) ?? "";
  // Normalization drops a few characters, so this is approximate; good enough to centre.
  const at = Math.max(0, needle ? findWordStart(normalizedLine, needle) : 0);
  const start = Math.max(0, Math.min(at - 50, line.length - SNIPPET_MAX));
  const end = Math.min(line.length, start + SNIPPET_MAX);
  return `${start > 0 ? "…" : ""}${line.slice(start, end).trim()}${end < line.length ? "…" : ""}`;
};

export interface LineMatch {
  index: number;
  tier: number;
  /** Every query word appears as a whole word in the line. */
  whole: boolean;
}

/**
 * Where `needle` starts a word in `text` (both normalized). Matching word starts rather than any
 * substring keeps «رخ» out of «چرخ» while still finding «یاران» for «یار» and the word being typed.
 */
export const findWordStart = (text: string, needle: string, from = 0) => {
  let at = text.indexOf(needle, from);
  while (at > 0 && text[at - 1] !== " ") {
    at = text.indexOf(needle, at + 1);
  }
  return at;
};

const hasWord = (text: string, word: string) => findWordStart(text, word) >= 0;

/** `word` standing alone, not as the start of a longer word («باران», not «بارانداز»). */
export const hasWholeWord = (text: string, word: string) => {
  let at = findWordStart(text, word);
  while (at >= 0) {
    const after = text[at + word.length];
    if (after === undefined || after === " ") {
      return true;
    }
    at = findWordStart(text, word, at + 1);
  }
  return false;
};

/**
 * The best line of a poem for the query and how good it is. `normalizedLines` must be
 * `normalizeSearchText` of each line. Ties prefer whole words over word starts.
 */
export const bestLine = (
  normalizedLines: string[],
  query: SearchQuery,
): LineMatch | null => {
  let best: LineMatch | null = null;
  let bestRank = 0;
  for (let index = 0; index < normalizedLines.length; index += 1) {
    const line = normalizedLines[index];
    let tier = 0;
    let whole = 0;
    if (query.isPhrase && hasWord(line, query.normalized)) {
      tier = 3;
      whole = hasWholeWord(line, query.normalized) ? query.words.length : 0;
    } else {
      const count = query.words.filter((word) => hasWord(line, word)).length;
      if (count === 0) {
        continue;
      }
      whole = query.words.filter((word) => hasWholeWord(line, word)).length;
      // A single word found in a line is as good as it gets for one-word queries.
      tier = count === query.words.length ? (query.isPhrase ? 2 : 3) : 1;
    }
    const rank = tier * 1000 + whole;
    if (rank > bestRank) {
      best = { index, tier, whole: whole === query.words.length };
      bestRank = rank;
      if (tier === 3 && whole === query.words.length) {
        break;
      }
    }
  }
  return best;
};

export const containsAllWords = (normalizedText: string, query: SearchQuery) =>
  query.words.every((word) => hasWord(normalizedText, word));

/** The line to show under the match: the next line, or the previous one at the end. */
export const contextFor = (
  lines: string[],
  index: number,
): Pick<PoemHit, "context" | "contextPosition"> => {
  if (lines[index + 1]) {
    return { context: lines[index + 1], contextPosition: "after" };
  }
  if (index > 0 && lines[index - 1]) {
    return { context: lines[index - 1], contextPosition: "before" };
  }
  return { context: null, contextPosition: null };
};

/**
 * Character ranges in `text` to highlight: the whole phrase where it occurs,
 * otherwise every query word. Works on the original (un-normalized) text.
 */
export const highlightRanges = (
  text: string,
  query: SearchQuery,
): Array<{ start: number; end: number }> => {
  if (!text || !query.normalized) {
    return [];
  }
  const normalizedChars: string[] = [];
  const indexMap: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const mapped = normalizeSearchText(text[index]) || (/\s/.test(text[index]) ? " " : "");
    for (const char of mapped) {
      normalizedChars.push(char);
      indexMap.push(index);
    }
  }
  const normalized = normalizedChars.join("");

  const find = (needle: string) => {
    const ranges: Array<{ start: number; end: number }> = [];
    let from = 0;
    while (needle && from < normalized.length) {
      const at = findWordStart(normalized, needle, from);
      if (at < 0) {
        break;
      }
      ranges.push({ start: indexMap[at], end: indexMap[at + needle.length - 1] + 1 });
      from = at + needle.length;
    }
    return ranges;
  };

  const phrase = query.isPhrase ? find(query.normalized) : [];
  const ranges = phrase.length > 0 ? phrase : query.words.flatMap(find);
  ranges.sort((left, right) => left.start - right.start);
  return ranges.reduce<Array<{ start: number; end: number }>>((merged, range) => {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
    return merged;
  }, []);
};
