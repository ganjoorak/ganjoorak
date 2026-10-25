import { NextResponse, type NextRequest } from "next/server";
import { searchGanjoor } from "@/server/ganjoorSearch";
import { parseQuery } from "@/utils/searchMatch";
import { MIN_SEARCH_QUERY_LENGTH } from "@/utils/searchText";
import { logger } from "@/utils/logger";

const CACHE_HEADERS = { "Cache-Control": "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400" };

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const query = parseQuery(params.get("q") ?? "");
  if (query.normalized.length < MIN_SEARCH_QUERY_LENGTH) {
    return NextResponse.json(
      { hits: [], next: null, phraseTotal: null, wordsTotal: 0 },
      { headers: CACHE_HEADERS },
    );
  }
  const poetId = Number(params.get("poetId"));

  try {
    const result = await searchGanjoor(query, {
      cursor: params.get("cursor"),
      poetId: Number.isInteger(poetId) && poetId > 0 ? poetId : null,
    });
    return NextResponse.json(result, { headers: CACHE_HEADERS });
  } catch (error) {
    logger.error("Ganjoor search failed:", error);
    return NextResponse.json({ error: "Ganjoor search unavailable" }, { status: 502 });
  }
}
