import type { Poem } from "@/types/poem";

/**
 * The poem's lines as the reader sees them: plainText split on newlines, each
 * trimmed, empty ones dropped. Line index i here is line i on screen (0-based),
 * which is what quotes and moshaere picks refer to (`/api/poem-lines` returns
 * exactly this list). A Ganjoor couplet is two consecutive lines.
 */
export const poemToLines = (poem: Pick<Poem, "plainText">): string[] =>
  (poem.plainText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
