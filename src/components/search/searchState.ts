import type { PoemLibrarySource } from "@/utils/poemLibrary";

export type SourceFilter = "all" | PoemLibrarySource;
export type SearchMode = "keyword" | "semantic";

export const SOURCE_FILTERS: Array<{ value: SourceFilter; label: string }> = [
  { value: "all", label: "همه" },
  { value: "ganjoor", label: "گنجور" },
  { value: "echolalia", label: "اکولالیا" },
  { value: "custom", label: "محلی" },
];
export const SEARCH_MODES: Array<{ value: SearchMode; label: string }> = [
  { value: "keyword", label: "واژه" },
  { value: "semantic", label: "معنا" },
];

/** Everything that defines a search; the page keeps it in the URL, the dialog in local state. */
export interface SearchParamsState {
  q: string;
  source: SourceFilter;
  poet: string | null;
  exact: boolean;
  mode: SearchMode;
  global: boolean;
}

export type SearchParamsUpdate = Partial<SearchParamsState>;

export const emptySearchState: SearchParamsState = {
  q: "",
  source: "all",
  poet: null,
  exact: false,
  mode: "keyword",
  global: false,
};

/** Applies an update and drops flags that don't apply to the resulting mode. */
export const applySearchUpdate = (current: SearchParamsState, next: SearchParamsUpdate): SearchParamsState => {
  const merged = { ...current, ...next, q: (next.q ?? current.q).trim() };
  const semantic = merged.mode === "semantic";
  return {
    ...merged,
    source: semantic ? "all" : merged.source,
    exact: merged.exact && !!merged.q && !semantic,
    global: merged.global && !!merged.q && semantic,
  };
};

export const readSearchParams = (params: URLSearchParams): SearchParamsState => {
  const source = params.get("source");
  return {
    q: params.get("q") ?? "",
    source: SOURCE_FILTERS.some((option) => option.value === source) ? (source as SourceFilter) : "all",
    poet: params.get("poet"),
    exact: params.get("exact") === "1",
    mode: params.get("mode") === "semantic" ? "semantic" : "keyword",
    global: params.get("global") === "1",
  };
};

export const searchHref = (state: SearchParamsState) => {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.mode === "semantic") params.set("mode", "semantic");
  if (state.source !== "all") params.set("source", state.source);
  if (state.poet) params.set("poet", state.poet);
  if (state.exact) params.set("exact", "1");
  if (state.global) params.set("global", "1");
  return params.toString() ? `/search?${params}` : "/search";
};
