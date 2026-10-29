// Moshaere compares verses by their letters only. These rules mirror
// backend/moshaere_letters.go; change both together (contract §6 "Letters").
// Used for instant hints (the required letter, "starts with the wrong letter").

const TATWEEL = "ـ";
const HAMZA = "ء";

/** Arabic forms that Persian writes with another letter. */
const LETTER_FOLDS: Record<string, string> = {
  ي: "ی",
  ى: "ی",
  ئ: "ی",
  ك: "ک",
  ة: "ه",
  ۀ: "ه",
  أ: "ا",
  إ: "ا",
  آ: "ا",
  ٱ: "ا",
  ؤ: "و",
};

// Built from a string: the project's TS target predates the `u` flag, the runtime does not.
const SCRIPT_LETTER = new RegExp("^(?=\\p{Script=Arabic})\\p{L}$", "u");

const isScriptLetter = (char: string) => char !== TATWEEL && SCRIPT_LETTER.test(char);

/**
 * A line reduced to its normalized letters: diacritics, tatweel, ZWNJ, spaces,
 * punctuation, digits and Latin drop out, and so does a trailing «ء».
 */
export const lineLetters = (line: string): string[] => {
  const letters: string[] = [];
  for (const raw of line) {
    const char = LETTER_FOLDS[raw] ?? raw;
    if (char !== raw || isScriptLetter(char)) {
      letters.push(char);
    }
  }
  while (letters.length > 0 && letters[letters.length - 1] === HAMZA) {
    letters.pop();
  }
  return letters;
};

interface LetterSpot {
  letter: string;
  at: number;
  length: number;
}

/** Like lineLetters, but remembering where each letter sits in the original text. */
const lineSpots = (line: string): LetterSpot[] => {
  const spots: LetterSpot[] = [];
  let at = 0;
  for (const raw of line) {
    const letter = LETTER_FOLDS[raw] ?? raw;
    if (letter !== raw || isScriptLetter(letter)) {
      spots.push({ letter, at, length: raw.length });
    }
    at += raw.length;
  }
  while (spots.length > 0 && spots[spots.length - 1].letter === HAMZA) {
    spots.pop();
  }
  return spots;
};

export interface EdgeLetter {
  /** Index into `lines`. */
  line: number;
  /** Character range of the letter in that line. */
  at: number;
  length: number;
  letter: string;
}

/**
 * Where the connecting letters sit in a verse, for highlighting: the first letter of the first
 * line that has one, and the last letter of the last line that has one.
 */
export const verseEdges = (lines: readonly string[]): { start: EdgeLetter | null; end: EdgeLetter | null } => {
  let start: EdgeLetter | null = null;
  let end: EdgeLetter | null = null;
  lines.forEach((line, index) => {
    const spots = lineSpots(line);
    if (spots.length === 0) return;
    if (!start) start = { line: index, ...spots[0] };
    end = { line: index, ...spots[spots.length - 1] };
  });
  return { start, end };
};

/** All lines' letters joined: what repeat checks compare. */
export const normalizeVerse = (lines: readonly string[]) =>
  lines.map((line) => lineLetters(line).join("")).join("");

/** First letter of the first line that has one, "" when there is none. */
export const firstLetter = (lines: readonly string[]) => {
  for (const line of lines) {
    const letters = lineLetters(line);
    if (letters.length > 0) return letters[0];
  }
  return "";
};

/** Last letter of the last line that has one, "" when there is none. */
export const lastLetter = (lines: readonly string[]) => {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const letters = lineLetters(lines[index]);
    if (letters.length > 0) return letters[letters.length - 1];
  }
  return "";
};

/** Total letters in a verse; the server wants at least MIN_VERSE_LETTERS. */
export const letterCount = (lines: readonly string[]) =>
  lines.reduce((total, line) => total + lineLetters(line).length, 0);

export const MIN_VERSE_LETTERS = 6;
export const MAX_VERSE_LINES = 2;
export const MIN_LINE_LENGTH = 2;
export const MAX_LINE_LENGTH = 120;

export type VerseIssue =
  | "empty"
  | "wrongStart"
  | "tooShort"
  | "tooLong"
  | "tooManyLines"
  | "lineTooShort";

/**
 * Client-side check of typed lines against the letter the verse must start
 * with. The server stays the authority (repeats, rate limits); this only
 * saves a round trip for the obvious mistakes. `null` means "looks fine".
 */
export const checkVerse = (lines: readonly string[], required: string): VerseIssue | null => {
  const filled = lines.map((line) => line.trim()).filter(Boolean);
  if (filled.length === 0) return "empty";
  if (filled.length > MAX_VERSE_LINES) return "tooManyLines";
  if (filled.some((line) => line.length > MAX_LINE_LENGTH)) return "tooLong";
  if (filled.some((line) => line.length < MIN_LINE_LENGTH)) return "lineTooShort";
  if (required && firstLetter(filled) !== required) return "wrongStart";
  if (letterCount(filled) < MIN_VERSE_LETTERS) return "tooShort";
  return null;
};
