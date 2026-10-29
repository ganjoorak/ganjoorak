import axios from "axios";

export const API_TIMEOUT_MS = 15000;
export const SEMANTIC_SEARCH_TIMEOUT_MS = 30000;
export const SEMANTIC_SEARCH_MAX_TOP_K = 50;

const SERVER_API_BASE_URL =
  process.env.GANJOOR_API_BASE_URL ||
  process.env.NEXT_PUBLIC_GANJOOR_API_BASE_URL ||
  "https://api.ganjoor.net";

const BROWSER_API_BASE_URL =
  process.env.NEXT_PUBLIC_GANJOOR_API_BASE_URL || "";

const normalizeBaseUrl = (url: string) => url.replace(/\/+$/, "");

export const API_BASE_URL =
  typeof window === "undefined"
    ? normalizeBaseUrl(SERVER_API_BASE_URL)
    : normalizeBaseUrl(BROWSER_API_BASE_URL);

export const ganjoorHttp = axios.create({
  proxy: false,
});

export const getAudioProxyUrl = (url?: string) =>
  url ? `/api/audio?url=${encodeURIComponent(url)}` : "";
