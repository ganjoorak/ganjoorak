// Server-only: custom poets read straight from public/poems on disk. CustomApi fetches the same files
// over HTTP, which a server component can't do reliably (no origin to resolve relative URLs against).

import { readFile } from "node:fs/promises";
import path from "node:path";
import { customPoetFromData } from "@/api/CustomApi";
import { PoetSlug, type Poet } from "@/types/poet";

export const getCustomPoetsFromDisk = (): Promise<Poet[]> =>
  Promise.all(
    Object.values(PoetSlug).map(async (slug) => {
      const raw = await readFile(path.join(process.cwd(), "public", "poems", `${slug}.json`), "utf8");
      return customPoetFromData(slug, JSON.parse(raw));
    }),
  );
