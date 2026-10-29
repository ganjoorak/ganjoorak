import type { GanjoorPagingHeaders } from "@/types/ganjoor";
import { logger } from "@/utils/logger";

export const emptyPaging = (
  pageNumber: number,
  pageSize: number,
): GanjoorPagingHeaders => ({
  totalCount: 0,
  pageSize,
  currentPage: pageNumber,
  totalPages: 0,
  hasPreviousPage: pageNumber > 1,
  hasNextPage: false,
});

export const readHeaderValue = (headers: unknown, name: string): string | undefined => {
  if (!headers || typeof headers !== "object") {
    return undefined;
  }

  const record = headers as {
    get?: (key: string) => string | undefined;
    [key: string]: unknown;
  };

  if (typeof record.get === "function") {
    return record.get(name) ?? record.get(name.toLowerCase()) ?? undefined;
  }

  const value =
    record[name] ??
    record[name.toLowerCase()] ??
    record["Paging-Headers"];
  return typeof value === "string" ? value : undefined;
};

export const parsePagingHeaders = (
  headers: unknown,
  pageNumber: number,
  pageSize: number,
  itemCount: number,
): GanjoorPagingHeaders => {
  const raw = readHeaderValue(headers, "paging-headers");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<GanjoorPagingHeaders>;
      const totalCount = Number(parsed.totalCount) || 0;
      const resolvedPageSize = Number(parsed.pageSize) || pageSize;
      const currentPage = Number(parsed.currentPage) || pageNumber;
      const totalPages = Number(parsed.totalPages) || 0;
      return {
        totalCount,
        pageSize: resolvedPageSize,
        currentPage,
        totalPages,
        hasPreviousPage:
          typeof parsed.hasPreviousPage === "boolean"
            ? parsed.hasPreviousPage
            : currentPage > 1,
        hasNextPage:
          typeof parsed.hasNextPage === "boolean"
            ? parsed.hasNextPage
            : currentPage < totalPages,
      };
    } catch (error) {
      logger.error("Failed to parse paging-headers:", error);
    }
  }

  const inferredHasNext = itemCount >= pageSize;
  return {
    totalCount: inferredHasNext
      ? pageNumber * pageSize + 1
      : (pageNumber - 1) * pageSize + itemCount,
    pageSize,
    currentPage: pageNumber,
    totalPages: inferredHasNext ? pageNumber + 1 : pageNumber,
    hasPreviousPage: pageNumber > 1,
    hasNextPage: inferredHasNext,
  };
};
