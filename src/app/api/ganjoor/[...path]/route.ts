import { NextRequest, NextResponse } from "next/server";
import {
  cachedGanjoorFetch,
  fetchGanjoorUpstream,
  getGanjoorCachePolicy,
  type CacheState,
  type UpstreamResponse,
} from "@/server/ganjoorCache";
import { getGanjoorUpstreamOrigin } from "@/server/ganjoorUpstream";

export const dynamic = "force-dynamic";

const GANJOOR_PROXY_TIMEOUT_MS = 15000;

// Anonymous proxy: only the URL is forwarded (no cookies, no Authorization), so responses are
// the same for every visitor and are cached per URL in memory (see ganjoorCache.ts for TTLs).
// next.config.js deliberately has no rewrite for /api/ganjoor/*: an external afterFiles rewrite
// runs before this dynamic route and would bypass it, and with it the cache.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: pathSegments } = await params;
  const path = pathSegments.map(encodeURIComponent).join("/");
  const upstream = new URL(
    `/api/ganjoor/${path}`,
    getGanjoorUpstreamOrigin(),
  );
  upstream.search = request.nextUrl.search;

  try {
    const policy = getGanjoorCachePolicy(upstream.pathname);
    const load = () => fetchGanjoorUpstream(upstream, GANJOOR_PROXY_TIMEOUT_MS);

    let response: UpstreamResponse;
    let state: CacheState | "BYPASS" = "BYPASS";
    if (policy) {
      ({ response, state } = await cachedGanjoorFetch(upstream.toString(), policy.ttlSeconds, load));
    } else {
      response = await load();
    }

    const headers = new Headers(response.headers);
    headers.set(
      "Cache-Control",
      policy && response.status === 200 ? policy.clientCacheControl : "no-store",
    );
    headers.set("X-Ganjoor-Cache", state);

    const empty = response.body.byteLength === 0 && [204, 205, 304].includes(response.status);
    return new NextResponse(empty ? null : (response.body as BodyInit), {
      status: response.status,
      headers,
    });
  } catch (error) {
    console.error("Error proxying Ganjoor API request:", error);
    return NextResponse.json(
      { error: "Failed to proxy Ganjoor API request" },
      { status: 502 },
    );
  }
}
