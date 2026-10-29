export type PoemSegment =
  | { type: "prose"; line: string; index: number }
  | { type: "centered"; line: string; index: number }
  | {
      type: "pair";
      lines: Array<{ line: string; index: number }>;
      pairIndex: number;
    };

// Lines this long are never a single mesra; used when Ganjoor block kinds
// are unavailable (older cached payloads).
const PROSE_LINE_MIN_CHARS = 120;

/** Splits a classical poem into couplets, prose paragraphs and centred lines; null when it is couplets only. */
export const buildPoemSegments = (
  lines: string[],
  kinds?: Array<"verse" | "prose" | "centered">,
): PoemSegment[] | null => {
  const useKinds = Boolean(kinds && kinds.length === lines.length);
  const isProse = (line: string, i: number) =>
    useKinds ? kinds![i] === "prose" : line.length >= PROSE_LINE_MIN_CHARS;
  // A centred line (Ganjoor b2) stands alone and must not shift the pairing.
  const isCentered = (i: number) => useKinds && kinds![i] === "centered";
  if (!lines.some((line, i) => isProse(line, i) || isCentered(i))) return null;

  const segments: PoemSegment[] = [];
  let run: Array<{ line: string; index: number }> = [];
  let pairIndex = 0;
  const flush = () => {
    for (let i = 0; i < run.length; i += 2) {
      segments.push({ type: "pair", lines: run.slice(i, i + 2), pairIndex });
      pairIndex += 1;
    }
    run = [];
  };
  lines.forEach((line, index) => {
    if (isProse(line, index)) {
      flush();
      segments.push({ type: "prose", line, index });
    } else if (isCentered(index)) {
      flush();
      segments.push({ type: "centered", line, index });
    } else {
      run.push({ line, index });
    }
  });
  flush();
  return segments;
};

export const chunk = (arr: string[], size: number) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, (i + 1) * size),
  );
