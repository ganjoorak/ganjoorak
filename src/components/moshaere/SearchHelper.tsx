"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FaSearch } from "react-icons/fa";
import { markLines } from "@/components/moshaere/MoveChain";
import { PoetAvatar } from "@/components/SearchHits";
import { usePoemSearch } from "@/hooks/usePoemSearch";
import { firstLetter, lineLetters, MAX_LINE_LENGTH } from "@/utils/moshaereLetters";
import type { VerseInput } from "@/utils/moshaereApi";
import { mergeHits } from "@/utils/searchClient";
import type { PoemHit } from "@/utils/searchMatch";
import { normalizeSearchText } from "@/utils/searchText";

interface Candidate {
  hit: PoemHit;
  lines: string[];
}

const EXTRA_PAGES_MAX = 4;
const ENOUGH_CANDIDATES = 6;

/** Words (letters after the app's normalization) a query needs before the search runs. */
const MIN_QUERY_WORDS = 2;
const MIN_WORD_LETTERS = 2;

/**
 * True once the query holds at least two words of two or more letters each. Words are split on
 * whitespace only, so a ZWNJ stays inside its word («می‌روم» is one word); ZWNJ, diacritics,
 * tatweel and punctuation don't count as letters.
 */
export const hasEnoughWords = (query: string) =>
  query
    .split(/\s+/)
    .filter((word) => lineLetters(word).length >= MIN_WORD_LETTERS).length >= MIN_QUERY_WORDS;

const poemLinesCache = new Map<string, Promise<string[]>>();

/** The poem's rendered lines (the indexing quotes and picked verses refer to). */
const fetchPoemLines = (key: string) => {
  let lines = poemLinesCache.get(key);
  if (!lines) {
    lines = fetch(`/api/poem-lines?key=${encodeURIComponent(key)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { lines?: string[] };
        if (!Array.isArray(body.lines)) throw new Error("no lines");
        return body.lines;
      })
      .catch((error) => {
        poemLinesCache.delete(key);
        throw error;
      });
    poemLinesCache.set(key, lines);
  }
  return lines;
};

const sameLine = (poemLine: string | undefined, wanted: string) => {
  if (poemLine === undefined) return false;
  const trimmed = wanted.includes("…");
  const left = normalizeSearchText(poemLine);
  const right = normalizeSearchText(wanted.replaceAll("…", ""));
  return left === right || (trimmed && left.includes(right));
};

/**
 * Turns a candidate into what the server wants: `{key, from, to}` when the couplet can be located
 * in the poem's lines, otherwise the typed lines (the server then treats it as typed).
 */
const toVerseInput = async (candidate: Candidate): Promise<VerseInput> => {
  const typed: VerseInput = { lines: candidate.lines };
  try {
    const poemLines = await fetchPoemLines(candidate.hit.key);
    const [first, second] = candidate.lines;
    for (let index = 0; index < poemLines.length; index += 1) {
      if (!sameLine(poemLines[index], first)) continue;
      if (second === undefined) return { key: candidate.hit.key, from: index, to: index };
      if (sameLine(poemLines[index + 1], second)) {
        return { key: candidate.hit.key, from: index, to: index + 1 };
      }
    }
  } catch {
    // The route is unavailable or the poem unknown: typed lines still work.
  }
  return typed;
};

const toCandidate = (hit: PoemHit, required: string): Candidate | null => {
  const lines = hit.context
    ? hit.contextPosition === "before"
      ? [hit.context, hit.line]
      : [hit.line, hit.context]
    : [hit.line];
  if (lines.some((line) => line.length > MAX_LINE_LENGTH)) return null;
  if (required && firstLetter(lines) !== required) return null;
  return { hit, lines };
};

/**
 * Search: type two words of a verse, get couplets whose first letter fits. Results come from the
 * app's own search and are shown only to the person using the search.
 */
export default function SearchHelper({
  required,
  busy,
  onPick,
}: {
  required: string;
  busy: boolean;
  onPick: (verse: VerseInput) => Promise<unknown>;
}) {
  const [term, setTerm] = useState("");
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const extraPages = useRef(0);

  // One letter or one word matches half the library: nothing is searched until there are two words.
  const ready = hasEnoughWords(term);
  const searchTerm = ready ? term : "";

  const { local, ganjoor, loadMore, enabled } = usePoemSearch({ term: searchTerm, local: true, ganjoor: true });

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const candidates = useMemo(() => {
    const seen = new Set<string>();
    return mergeHits(searchTerm, local.hits, ganjoor.hits, ganjoor.firstPage)
      .map((hit) => toCandidate(hit, required))
      .filter((candidate): candidate is Candidate => {
        if (!candidate) return false;
        const id = `${candidate.hit.key}|${normalizeSearchText(candidate.lines[0])}`;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
  }, [ganjoor.firstPage, ganjoor.hits, local.hits, required, searchTerm]);

  const loading = enabled && (local.status === "loading" || ganjoor.status === "loading" || ganjoor.loadingMore);

  // Few fit the letter: keep paging Ganjoor in the background, within reason.
  useEffect(() => {
    extraPages.current = 0;
  }, [searchTerm, required]);
  useEffect(() => {
    if (
      enabled &&
      ganjoor.status === "done" &&
      ganjoor.next &&
      !ganjoor.loadingMore &&
      candidates.length < ENOUGH_CANDIDATES &&
      extraPages.current < EXTRA_PAGES_MAX
    ) {
      extraPages.current += 1;
      loadMore();
    }
  }, [candidates.length, enabled, ganjoor.loadingMore, ganjoor.next, ganjoor.status, loadMore]);

  const pick = async (candidate: Candidate) => {
    if (busy) return;
    const id = `${candidate.hit.key}|${candidate.lines[0]}`;
    setPickedKey(id);
    try {
      await onPick(await toVerseInput(candidate));
    } finally {
      setPickedKey(null);
    }
  };

  return (
    <div className="grid gap-2">
      <label className="search-field msh-field--compact">
        <FaSearch className="search-field-icon" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={required ? `دو کلمه از بیتی که با «${required}» شروع می‌شود…` : "دو کلمه از بیت…"}
          aria-label="جست‌وجوی بیت"
          enterKeyHint="search"
          autoComplete="off"
        />
      </label>

      {!ready ? (
        <p className="px-1 text-sm leading-7 text-muted-foreground" role="status">
          دست‌کم دو کلمه بنویسید
        </p>
      ) : candidates.length > 0 ? (
        <ul className="search-hits msh-candidates">
          {candidates.map((candidate) => {
            const id = `${candidate.hit.key}|${candidate.lines[0]}`;
            const marked = markLines(candidate.lines, "start");
            return (
              <li key={id} className="search-hit is-compact">
                <button
                  type="button"
                  className="search-hit-link w-full cursor-pointer text-start font-[inherit] disabled:cursor-default disabled:opacity-60"
                  disabled={busy}
                  aria-busy={pickedKey === id}
                  onClick={() => void pick(candidate)}
                >
                  <span className="search-hit-verse">
                    {marked.map((line, index) => (
                      <span key={index} className={`search-hit-line${index === 0 ? " is-match" : ""}`}>
                        {line}
                      </span>
                    ))}
                  </span>
                  <span className="search-hit-meta">
                    <PoetAvatar src={candidate.hit.avatarUrl} name={candidate.hit.poetName} size={20} />
                    <span className="search-hit-crumb">
                      <strong>{candidate.hit.poetName}</strong>
                      {candidate.hit.title && <span>{candidate.hit.title}</span>}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : loading ? (
        <p className="px-1 text-sm leading-7 text-muted-foreground" role="status">
          در حال جست‌وجو…
        </p>
      ) : (
        <p className="px-1 text-sm leading-7 text-muted-foreground" role="status">
          {required
            ? `بیتی که با «${required}» شروع شود پیدا نشد. کلمه‌های دیگری امتحان کنید.`
            : "بیتی پیدا نشد. کلمه‌های دیگری امتحان کنید."}
        </p>
      )}
    </div>
  );
}
