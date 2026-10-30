// Server-only axios adapter: lets server components and route handlers (poem pages, /poets,
// daily poem, poem-lines) share the proxy's in-memory Ganjoor cache. Requests that are not
// cacheable (random poems, search, other hosts, non-JSON bodies) go to axios' normal adapter.

import axios, { AxiosError, type AxiosAdapter, type AxiosResponse } from "axios";
import { cachedGanjoorFetch, fetchGanjoorUpstream, getGanjoorCachePolicy } from "@/server/ganjoorCache";
import { getGanjoorUpstreamOrigin } from "@/server/ganjoorUpstream";

const DEFAULT_TIMEOUT_MS = 15000;

export const ganjoorCachingAdapter: AxiosAdapter = async (config) => {
  const fallback = () => axios.getAdapter(axios.defaults.adapter)(config);

  const method = (config.method || "get").toLowerCase();
  const responseType = config.responseType;
  if (method !== "get" || (responseType && responseType !== "json" && responseType !== "text")) {
    return fallback();
  }

  let target: URL;
  try {
    target = new URL(axios.getUri(config));
  } catch {
    return fallback();
  }
  const policy =
    target.origin === getGanjoorUpstreamOrigin() ? getGanjoorCachePolicy(target.pathname) : null;
  if (!policy) {
    return fallback();
  }

  const timeout = config.timeout || DEFAULT_TIMEOUT_MS;
  let upstream;
  try {
    ({ response: upstream } = await cachedGanjoorFetch(target.toString(), policy.ttlSeconds, () =>
      fetchGanjoorUpstream(target, timeout),
    ));
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new AxiosError(
      timedOut ? `timeout of ${timeout}ms exceeded` : "Network Error",
      timedOut ? AxiosError.ECONNABORTED : AxiosError.ERR_NETWORK,
      config,
      null,
    );
  }

  const response: AxiosResponse = {
    data: new TextDecoder().decode(upstream.body),
    status: upstream.status,
    statusText: "",
    headers: upstream.headers,
    config,
    request: null,
  };

  if (!config.validateStatus || config.validateStatus(upstream.status)) {
    return response;
  }
  throw new AxiosError(
    `Request failed with status code ${upstream.status}`,
    upstream.status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
    config,
    null,
    response,
  );
};
