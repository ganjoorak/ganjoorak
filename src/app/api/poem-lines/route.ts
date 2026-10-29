import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import ganjoorApi from "@/api/GanjoorApi";
import { API_BASE_URL, API_TIMEOUT_MS, ganjoorHttp } from "@/api/ganjoor/client";
import {
  decodeHtmlEntities,
  decodeWordPressSlug,
  htmlToPlainText,
  isHiddenEcholaliaPoetSlug,
} from "@/api/EcholaliaApi";
import { getCategory, getPost } from "@/lib/echolaliaStore";
import type { Poem } from "@/types/poem";
import { isValidPoetSlug, poetNames } from "@/types/poet";
import { logger } from "@/utils/logger";
import { poemToLibraryEntry } from "@/utils/poemLibrary";
import { poemToLines } from "@/utils/poemLines";

// Resolves a poem key (source:poetSlug:id) to the lines the poem viewer renders. The accounts
// service cuts quotes and moshaere verses from this, so the text never comes from a client.

export const dynamic = "force-dynamic";

// Same pattern as the Go service; built from a string because the tsconfig target predates the u flag.
const KEY_PATTERN = new RegExp("^(ganjoor|custom|echolalia):([\\p{L}\\p{N}_.-]+):([0-9]+)$", "u");

class PoemNotFoundError extends Error {}

const emptyPoem = (
  fields: Pick<Poem, "id" | "title" | "fullTitle" | "poet" | "poetSlug" | "plainText" | "source">,
): Poem => ({
  poetNickname: "",
  poetImageUrl: "",
  urlSlug: "",
  fullUrl: "",
  htmlText: "",
  recitations: [],
  ...fields,
});

const loadGanjoorPoem = async (id: number): Promise<Poem> => {
  try {
    const response = await ganjoorHttp.get(`${API_BASE_URL}/api/ganjoor/poem/${id}`, {
      timeout: API_TIMEOUT_MS,
      headers: { Accept: "application/json" },
    });
    return ganjoorApi.mapPoemResponse(response.data);
  } catch (error) {
    const status = (error as { response?: { status?: number } })?.response?.status;
    if (status === 404) throw new PoemNotFoundError();
    throw error;
  }
};

const loadCustomPoem = async (poetSlug: string, id: number): Promise<Poem> => {
  // Only the known poets; this also keeps the slug out of the file path otherwise.
  if (!isValidPoetSlug(poetSlug)) throw new PoemNotFoundError();
  const file = path.join(process.cwd(), "public", "poems", `${poetSlug}.json`);
  const data = JSON.parse(await readFile(file, "utf8")) as {
    poems?: Array<{ id: number; title: string; text: string; collection?: string }>;
  };
  const local = data.poems?.find((poem) => poem.id === id);
  if (!local) throw new PoemNotFoundError();
  // Same mapping as CustomApi.mapLocalPoemToPoem.
  const collection = typeof local.collection === "string" ? local.collection.trim() : "";
  const poet = poetNames[poetSlug];
  return emptyPoem({
    id: local.id,
    title: local.title,
    fullTitle: collection ? `${poet} » ${collection} » ${local.title}` : local.title,
    poet,
    poetSlug,
    plainText: local.text,
    source: "custom",
  });
};

const loadEcholaliaPoem = async (id: number): Promise<Poem> => {
  const post = await getPost(id);
  const category = post ? await getCategory(post.categories[0]) : null;
  if (!post || !category || isHiddenEcholaliaPoetSlug(category.slug)) {
    throw new PoemNotFoundError();
  }
  // Same mapping as EcholaliaApi.getPoemById.
  const title = decodeHtmlEntities(post.title?.rendered ?? "");
  return emptyPoem({
    id: post.id,
    title,
    fullTitle: `${category.name} » ${title}`,
    poet: category.name,
    poetSlug: decodeWordPressSlug(category.slug),
    plainText: htmlToPlainText(post.content?.rendered ?? ""),
    source: "echolalia",
  });
};

const loadPoem = (source: string, poetSlug: string, id: number) =>
  source === "ganjoor"
    ? loadGanjoorPoem(id)
    : source === "custom"
      ? loadCustomPoem(poetSlug, id)
      : loadEcholaliaPoem(id);

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key") ?? "";
  const match = KEY_PATTERN.exec(key);
  const id = match ? Number(match[3]) : 0;
  if (!match || !Number.isSafeInteger(id) || id < 1) {
    return NextResponse.json({ error: "کلید شعر معتبر نیست." }, { status: 400 });
  }

  try {
    const poem = await loadPoem(match[1], match[2], id);
    const entry = poemToLibraryEntry(poem);
    // Keys are canonical: the same poem under another poet slug is a different (unknown) key.
    if (entry.key !== key) throw new PoemNotFoundError();
    const lines = poemToLines(poem);
    if (lines.length === 0) throw new PoemNotFoundError();

    return NextResponse.json(
      {
        key,
        source: entry.source,
        poetSlug: entry.poetSlug,
        poetName: entry.poetName,
        title: entry.title,
        href: entry.href,
        lines,
      },
      { headers: { "Cache-Control": "public, max-age=3600" } },
    );
  } catch (error) {
    if (error instanceof PoemNotFoundError) {
      return NextResponse.json({ error: "این شعر پیدا نشد." }, { status: 404 });
    }
    logger.error("Failed to resolve poem lines:", error);
    return NextResponse.json({ error: "دریافت شعر ممکن نشد." }, { status: 502 });
  }
}
