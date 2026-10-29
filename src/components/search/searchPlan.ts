import type { DirectoryPoet } from "@/utils/poetDirectory";
import {
  MIN_SEARCH_QUERY_LENGTH,
  normalizeSearchText,
  parseSearchIntent,
} from "@/utils/searchText";

interface Plan {
  term: string;
  normalizedQuery: string;
  poet: DirectoryPoet | null;
  poetFromIntent: boolean;
  shouldSearch: boolean;
}

/**
 * «حافظ عشق» searches «عشق» in Hafez; a bare poet name («فروغ») is not a filter — the poet shows
 * up as a poet result and the word is searched everywhere.
 */
export const buildPlan = (
  query: string,
  explicitPoet: DirectoryPoet | null,
  exact: boolean,
  directory: DirectoryPoet[],
): Plan => {
  const normalizedQuery = normalizeSearchText(query);
  const shouldSearch = normalizedQuery.length >= MIN_SEARCH_QUERY_LENGTH;
  if (!shouldSearch || exact || explicitPoet) {
    return { term: normalizedQuery, normalizedQuery, poet: explicitPoet, poetFromIntent: false, shouldSearch };
  }
  const intent = parseSearchIntent(query, directory);
  if (intent.poet && intent.hasTerm) {
    return {
      term: intent.term,
      normalizedQuery,
      poet: intent.poet as DirectoryPoet,
      poetFromIntent: true,
      shouldSearch,
    };
  }
  return { term: normalizedQuery, normalizedQuery, poet: null, poetFromIntent: false, shouldSearch };
};
