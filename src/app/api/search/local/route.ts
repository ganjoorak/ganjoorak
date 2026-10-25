import { NextResponse, type NextRequest } from "next/server";
import { searchLocal } from "@/server/localSearch";
import { parseQuery } from "@/utils/searchMatch";
import { MIN_SEARCH_QUERY_LENGTH } from "@/utils/searchText";
import { logger } from "@/utils/logger";

// The data only changes when the mirror is re-scraped, so identical queries can be served from cache.
const CACHE_HEADERS = { "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" };

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const query = parseQuery(params.get("q") ?? "");
  if (query.normalized.length < MIN_SEARCH_QUERY_LENGTH) {
    return NextResponse.json({ hits: [], total: 0, counts: { custom: 0, echolalia: 0 } }, { headers: CACHE_HEADERS });
  }
  const source = params.get("source");

  try {
    const result = await searchLocal(query, {
      poetSlug: params.get("poet"),
      source: source === "custom" || source === "echolalia" ? source : null,
      limit: Math.min(Math.max(Number(params.get("limit")) || 30, 1), 100),
      offset: Math.max(Number(params.get("offset")) || 0, 0),
    });
    return NextResponse.json(result, { headers: CACHE_HEADERS });
  } catch (error) {
    logger.error("Local search failed:", error);
    return NextResponse.json({ error: "Local search unavailable" }, { status: 500 });
  }
}
