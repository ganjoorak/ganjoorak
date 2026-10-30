// Server-only, dependency-free cache for api.ganjoor.net GET responses.
//
// Every upstream round trip can cost seconds, so the same poem or the poet list should not be
// fetched more than once per few hours. Used by the `/api/ganjoor/*`
// proxy route (browser traffic) and by the axios adapter in `ganjoorAxiosAdapter.ts` (server
// components and route handlers), so both share one store and one upstream fetch per URL.
//
// - In-memory LRU capped by entry count and bytes. It lives on `globalThis` because route
//   handlers and server components are bundled separately and would otherwise each get a copy.
// - In-flight de-duplication: concurrent requests for a URL share one upstream fetch.
// - Only 200 responses are stored; errors and timeouts are never cached.
// - Stale-while-revalidate: for one extra TTL after expiry the stale copy is served at once and
//   refreshed in the background, so a slow upstream is paid for by nobody.
//
// The upstream is anonymous: no cookies, Authorization or user headers are ever forwarded, and
// the key is only the URL, so sharing responses between visitors is safe.

export interface UpstreamResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

export interface GanjoorCachePolicy {
  /** How long the server keeps a response fresh. */
  ttlSeconds: number;
  /** Cache-Control sent to browsers and the service worker. */
  clientCacheControl: string;
}

const HOUR = 60 * 60;

/** Poem bodies are effectively immutable (recitations are the only thing that changes). */
const POEM: GanjoorCachePolicy = {
  ttlSeconds: 24 * HOUR,
  clientCacheControl: "public, max-age=3600, stale-while-revalidate=86400",
};

/** Poets, centuries, categories, quoted poems: change when Ganjoor's editors publish. */
const CATALOG: GanjoorCachePolicy = {
  ttlSeconds: 6 * HOUR,
  clientCacheControl: "public, max-age=3600, stale-while-revalidate=86400",
};

/** Poet portraits; upstream already says max-age=86400. */
const IMAGE: GanjoorCachePolicy = {
  ttlSeconds: 24 * HOUR,
  clientCacheControl: "public, max-age=86400, stale-while-revalidate=604800",
};

const isNumeric = (value: string | undefined) => value !== undefined && /^\d+$/.test(value);

/**
 * Cache policy for an upstream path (`/api/ganjoor/...`), or null when it must not be cached:
 * random poems, full-text search (huge, and `ganjoorSearch.ts` has its own cache) and any
 * endpoint this app does not use.
 */
export function getGanjoorCachePolicy(pathname: string): GanjoorCachePolicy | null {
  const prefix = "/api/ganjoor/";
  if (!pathname.startsWith(prefix)) {
    return null;
  }
  const parts = pathname.slice(prefix.length).split("/").filter(Boolean);
  const [head, second, third] = parts;

  switch (head) {
    case "poem":
      if (parts.length === 1) return POEM; // poem?url=/hafez/ghazal/sh1
      if (isNumeric(second)) {
        if (parts.length === 2) return POEM;
        if (parts.length === 3 && third === "quoteds") return CATALOG;
      }
      return null; // poem/random and friends
    case "poets":
    case "centuries":
      return parts.length === 1 ? CATALOG : null;
    case "poet":
      if (parts.length === 1) return CATALOG; // poet?url=/hafez
      if (second === "image" && parts.length === 3) return IMAGE;
      if (isNumeric(second) && parts.length === 2) return CATALOG;
      return null;
    case "cat":
      if (parts.length === 1) return CATALOG;
      if (isNumeric(second) && (parts.length === 2 || (parts.length === 3 && third === "geotag"))) {
        return CATALOG;
      }
      return null;
    default:
      return null;
  }
}

const MAX_ENTRIES = 3000;
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ENTRY_BYTES = 2 * 1024 * 1024;

interface Entry {
  value: UpstreamResponse;
  freshUntil: number;
  staleUntil: number;
  bytes: number;
}

interface Store {
  entries: Map<string, Entry>; // insertion order = LRU order, oldest first
  inflight: Map<string, Promise<UpstreamResponse>>;
  bytes: number;
}

const globalStore = globalThis as typeof globalThis & { __ganjoorCache?: Store };
const store: Store = (globalStore.__ganjoorCache ??= {
  entries: new Map(),
  inflight: new Map(),
  bytes: 0,
});

const remove = (key: string) => {
  const entry = store.entries.get(key);
  if (entry) {
    store.bytes -= entry.bytes;
    store.entries.delete(key);
  }
};

const put = (key: string, value: UpstreamResponse, ttlSeconds: number) => {
  const bytes = value.body.byteLength + key.length;
  remove(key);
  if (bytes > MAX_ENTRY_BYTES) {
    return;
  }
  const now = Date.now();
  store.entries.set(key, {
    value,
    freshUntil: now + ttlSeconds * 1000,
    staleUntil: now + ttlSeconds * 2000,
    bytes,
  });
  store.bytes += bytes;
  while (store.entries.size > MAX_ENTRIES || store.bytes > MAX_BYTES) {
    const oldest = store.entries.keys().next();
    if (oldest.done) {
      break;
    }
    remove(oldest.value);
  }
};

const refresh = (
  key: string,
  ttlSeconds: number,
  load: () => Promise<UpstreamResponse>,
): Promise<UpstreamResponse> => {
  const running = store.inflight.get(key);
  if (running) {
    return running;
  }
  const flight = load()
    .then((value) => {
      if (value.status === 200) {
        put(key, value, ttlSeconds);
      }
      return value;
    })
    .finally(() => {
      store.inflight.delete(key);
    });
  store.inflight.set(key, flight);
  return flight;
};

export type CacheState = "HIT" | "STALE" | "MISS";

/**
 * Response for `key`, from memory when fresh, else from `load()` (shared between concurrent
 * callers). `load` must resolve with whatever upstream answered; only status 200 is stored.
 */
export async function cachedGanjoorFetch(
  key: string,
  ttlSeconds: number,
  load: () => Promise<UpstreamResponse>,
): Promise<{ response: UpstreamResponse; state: CacheState }> {
  const now = Date.now();
  const entry = store.entries.get(key);

  if (entry && now < entry.staleUntil) {
    // Touch: move to the most recently used end.
    store.entries.delete(key);
    store.entries.set(key, entry);
    if (now < entry.freshUntil) {
      return { response: entry.value, state: "HIT" };
    }
    // Stale: answer now, refresh behind the scenes (a failed refresh keeps the stale copy).
    refresh(key, ttlSeconds, load).catch(() => undefined);
    return { response: entry.value, state: "STALE" };
  }

  if (entry) {
    remove(key);
  }
  return { response: await refresh(key, ttlSeconds, load), state: "MISS" };
}

/** Response headers that must not be stored or forwarded from upstream. */
const DROPPED_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "date",
  "keep-alive",
  "server",
  "set-cookie",
  "transfer-encoding",
  "vary",
  "x-powered-by",
]);

/** One anonymous GET to Ganjoor. Resolves for any HTTP status; rejects on network errors/timeouts. */
export async function fetchGanjoorUpstream(url: URL, timeoutMs: number): Promise<UpstreamResponse> {
  const response = await fetch(url, {
    headers: { Accept: "application/json, text/plain, */*" },
    // No `cache: "no-store"`: that would opt /poets out of ISR. Under force-dynamic routes Next
    // does not cache fetch anyway, and in a prerender it revalidates with the page.
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = new Uint8Array(await response.arrayBuffer());
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    if (!DROPPED_HEADERS.has(name.toLowerCase())) {
      headers[name.toLowerCase()] = value;
    }
  });
  return { status: response.status, headers, body };
}
