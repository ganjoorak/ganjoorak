import axios from "axios";
import type { Poem, VerseSync } from "@/types/poem";
import type { Poet, Century } from "@/types/poet";
import type {
  GanjoorCategory,
  GanjoorPoetCatalog,
  GanjoorPoemSearchPage,
  GanjoorSemanticSearchResponse,
  GanjoorQuotedPoem,
  PoemGeoDateTag,
} from "@/types/ganjoor";
import { logger } from "@/utils/logger";
import { getIndexedPoetImageUrl } from "@/utils/poetImages";
import {
  API_TIMEOUT_MS,
  SEMANTIC_SEARCH_TIMEOUT_MS,
  SEMANTIC_SEARCH_MAX_TOP_K,
  API_BASE_URL,
  ganjoorHttp,
} from "@/api/ganjoor/client";
import { emptyPaging, parsePagingHeaders } from "@/api/ganjoor/paging";
import { helpers, mapPoetResponse, mapPoemResponse } from "@/api/ganjoor/mappers";
import { collectPoemIdsFromCategory, uniqueGeoLocations } from "@/api/ganjoor/geo";

// Cache for poet data
const poetCache: Record<string, Poet | undefined> = {};
let poetsListPromise: Promise<Poet[]> | null = null;
const poetCatalogCache: Record<string, GanjoorPoetCatalog | undefined> = {};
const poetCatalogPromiseCache: Record<
  string,
  Promise<GanjoorPoetCatalog> | undefined
> = {};

const cachePoetCatalog = (catalog: GanjoorPoetCatalog, aliases: string[] = []) => {
  const keys = [
    catalog.poet.urlSlug,
    catalog.poet.id ? `id:${catalog.poet.id}` : "",
    ...aliases,
  ].filter(Boolean);

  keys.forEach((key) => {
    poetCatalogCache[key] = catalog;
  });
};

const getCachedPoetCatalog = (keys: string[]) =>
  keys.map((key) => poetCatalogCache[key]).find(Boolean);

const ganjoorApi = {
  async getRandomPoem(): Promise<Poem> {
    try {
      const response = await ganjoorHttp.get(
        `${API_BASE_URL}/api/ganjoor/poem/random`,
        {
          timeout: API_TIMEOUT_MS,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        },
      );

      return ganjoorApi.mapPoemResponse(response.data);
    } catch (error) {
      logger.error("Error fetching random poem:", error);
      throw new Error(
        "متأسفانه در دریافت شعر تصادفی مشکلی پیش آمد. لطفاً دوباره تلاش کنید",
      );
    }
  },

  async getPoemById(id: number): Promise<Poem> {
    try {
      // Validate ID before making request
      if (isNaN(id) || id < 1) {
        throw new Error("شناسه شعر معتبر نیست");
      }

      // No cache check - always fetch fresh data
      logger.log("Fetching poem:", id);
      const response = await ganjoorHttp.get(
        `${API_BASE_URL}/api/ganjoor/poem/${id}`,
        {
          timeout: API_TIMEOUT_MS,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        },
      );

      logger.log("API Response:", response.data);
      // Don't cache the response
      return ganjoorApi.mapPoemResponse(response.data);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error("API Error:", error.response?.data);
        if (error.response?.status === 404) {
          throw new Error("متأسفانه شعر مورد نظر پیدا نشد");
        }
        throw new Error(
          "متأسفانه در ارتباط با سرور مشکلی پیش آمد. لطفاً دوباره تلاش کنید",
        );
      }
      throw error;
    }
  },

  async getPoets(): Promise<Poet[]> {
    // The catalog is requested by several screens (home feed, search, dialogs);
    // share one in-flight/completed request per session instead of refetching.
    if (!poetsListPromise) {
      poetsListPromise = ganjoorApi.fetchPoets().catch((error) => {
        poetsListPromise = null;
        throw error;
      });
    }
    return poetsListPromise;
  },

  async fetchPoets(): Promise<Poet[]> {
    const response = await ganjoorHttp.get(`${API_BASE_URL}/api/ganjoor/poets`, {
      timeout: API_TIMEOUT_MS,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });

    return response.data.map((poet: any) => ({
      id: poet.id,
      name: poet.name,
      description: poet.description,
      fullUrl: poet.fullUrl,
      urlSlug: poet.fullUrl.slice(1), // Remove the leading slash
      rootCatId: poet.rootCatId,
      nickname: poet.nickname,
      published: poet.published,
      imageUrl:
        getIndexedPoetImageUrl("ganjoor", poet.fullUrl.slice(1)) ||
        `${API_BASE_URL}/api/ganjoor/poet/image/${poet.fullUrl.slice(1)}.gif`,
      birthYearInLHijri: poet.birthYearInLHijri,
      validBirthDate: poet.validBirthDate,
      deathYearInLHijri: poet.deathYearInLHijri,
      validDeathDate: poet.validDeathDate,
      pinOrder: poet.pinOrder,
      birthPlace: poet.birthPlace,
      birthPlaceLatitude: poet.birthPlaceLatitude,
      birthPlaceLongitude: poet.birthPlaceLongitude,
      deathPlace: poet.deathPlace,
      deathPlaceLatitude: poet.deathPlaceLatitude,
      deathPlaceLongitude: poet.deathPlaceLongitude,
      source: "ganjoor",
      sourceGroupName: "شاعران کهن",
    }));
  },

  async searchPoems(
    term: string,
    {
      pageSize = 12,
      pageNumber = 1,
      poetId,
      catId,
      signal,
    }: {
      pageSize?: number;
      pageNumber?: number;
      poetId?: number;
      catId?: number;
      signal?: AbortSignal;
    } = {},
  ): Promise<GanjoorPoemSearchPage> {
    const normalizedTerm = term.trim();
    if (normalizedTerm.length < 2) {
      return {
        items: [],
        paging: emptyPaging(pageNumber, pageSize),
      };
    }

    try {
      const response = await ganjoorHttp.get(
        `${API_BASE_URL}/api/ganjoor/poems/search`,
        {
          timeout: API_TIMEOUT_MS,
          signal,
          params: {
            term: normalizedTerm,
            PageNumber: pageNumber,
            PageSize: pageSize,
            ...(poetId && poetId > 0 ? { poetId } : {}),
            ...(catId && catId > 0 ? { catId } : {}),
          },
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        },
      );

      const items = Array.isArray(response.data)
        ? response.data.map((poem: any) => helpers.mapPoemSearchResult(poem))
        : [];

      return {
        items,
        paging: parsePagingHeaders(
          response.headers,
          pageNumber,
          pageSize,
          items.length,
        ),
      };
    } catch (error) {
      if (axios.isCancel(error) || signal?.aborted) {
        throw error;
      }
      logger.error("Error searching poems:", error);
      throw new Error("متأسفانه در جست‌وجوی شعرها مشکلی پیش آمد");
    }
  },

  async searchPoemsSemantic(
    query: string,
    {
      topK = 10,
      poetId,
      catId,
      disableScopeDetection = false,
      signal,
    }: {
      topK?: number;
      poetId?: number;
      catId?: number;
      disableScopeDetection?: boolean;
      signal?: AbortSignal;
    } = {},
  ): Promise<GanjoorSemanticSearchResponse> {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2) {
      return {
        query: normalizedQuery,
        results: [],
        detectedPoetName: null,
        detectedCategoryName: null,
      };
    }

    const resolvedTopK =
      Number.isFinite(topK) && topK > 0 && topK <= SEMANTIC_SEARCH_MAX_TOP_K
        ? Math.floor(topK)
        : 10;

    try {
      const response = await ganjoorHttp.post(
        `${API_BASE_URL}/api/ganjoor/search/semantic`,
        {
          query: normalizedQuery,
          topK: resolvedTopK,
          disableScopeDetection: Boolean(disableScopeDetection),
          ...(poetId && poetId > 0 ? { poetId } : {}),
          ...(catId && catId > 0 ? { catId } : {}),
        },
        {
          timeout: SEMANTIC_SEARCH_TIMEOUT_MS,
          signal,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        },
      );

      const payload = response.data ?? {};
      const results = Array.isArray(payload.results)
        ? payload.results.map((poem: any) => helpers.mapSemanticSearchResult(poem))
        : [];

      return {
        query: payload.query ?? normalizedQuery,
        results,
        detectedPoetName: payload.detectedPoetName ?? null,
        detectedCategoryName: payload.detectedCategoryName ?? null,
      };
    } catch (error) {
      if (axios.isCancel(error) || signal?.aborted) {
        throw error;
      }
      if (axios.isAxiosError(error) && error.response?.status === 503) {
        logger.error("Semantic search unavailable:", error);
        throw new Error("در حال حاضر جست‌وجوی معنایی در دسترس نیست");
      }
      logger.error("Error in semantic poem search:", error);
      throw new Error("متأسفانه در جست‌وجوی معنایی مشکلی پیش آمد");
    }
  },

  async getCenturies(): Promise<Century[]> {
    const response = await ganjoorHttp.get(`${API_BASE_URL}/api/ganjoor/centuries`, {
      timeout: API_TIMEOUT_MS,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });

    // Transform the response to fix image URLs
    return response.data.map((century: any) => ({
      ...century,
      poets: century.poets.map((poet: any) => ({
        ...poet,
        imageUrl:
          getIndexedPoetImageUrl(
            "ganjoor",
            String(poet.fullUrl || "").replace(/^\/+/, "").split("/")[0],
          ) || `${API_BASE_URL}${poet.imageUrl}`,
        fullUrl: poet.fullUrl.startsWith("/")
          ? poet.fullUrl.slice(1)
          : poet.fullUrl,
      })),
    }));
  },

  async getRandomPoemByPoetId(poetId: number): Promise<Poem> {
    if (!Number.isInteger(poetId) || poetId < 1) {
      throw new Error("شناسه شاعر معتبر نیست");
    }

    try {
      // Don't use session storage cache - always get fresh data
      const response = await ganjoorHttp.get(
        `${API_BASE_URL}/api/ganjoor/poem/random?poetId=${poetId}`,
        {
          timeout: API_TIMEOUT_MS,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        },
      );

      // Don't check or store in cache
      return ganjoorApi.mapPoemResponse(response.data);
    } catch (error) {
      logger.error("Error fetching random poem:", error);
      throw new Error(
        "متأسفانه در دریافت شعر مشکلی پیش آمد. لطفاً دوباره تلاش کنید",
      );
    }
  },

  async getRandomPoemByPoet(slug: string): Promise<Poem> {
    const poet = await ganjoorApi.getPoetBySlug(slug);
    return ganjoorApi.getRandomPoemByPoetId(poet.id);
  },

  async getPoetImage(poetSlug: string): Promise<string> {
    const response = await ganjoorHttp.get(
      `${API_BASE_URL}/api/ganjoor/poet/image/${poetSlug}.gif`,
      {
        timeout: API_TIMEOUT_MS,
        headers: {
          Accept: "image/gif",
        },
      },
    );
    return response.data;
  },

  mapPoetResponse,

  async getPoetCatalogById(poetId: number): Promise<GanjoorPoetCatalog> {
    try {
      if (!Number.isInteger(poetId) || poetId < 1) {
        throw new Error("شناسه شاعر معتبر نیست");
      }

      const cacheKey = `id:${poetId}`;
      if (poetCatalogCache[cacheKey]) {
        return poetCatalogCache[cacheKey];
      }

      if (poetCatalogPromiseCache[cacheKey]) {
        return await poetCatalogPromiseCache[cacheKey];
      }

      const request = (async () => {
        const response = await ganjoorHttp.get(
          `${API_BASE_URL}/api/ganjoor/poet/${poetId}`,
          {
            timeout: API_TIMEOUT_MS,
            params: {
              catPoems: true,
            },
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          },
        );

        if (!response.data?.poet || !response.data?.cat) {
          throw new Error("Invalid poet catalog data");
        }

        const mappedPoet = ganjoorApi.mapPoetResponse(response.data);
        if (mappedPoet.urlSlug) {
          poetCache[mappedPoet.urlSlug] = mappedPoet;
        }

        const catalog = {
          poet: mappedPoet,
          category: helpers.mapCategory(response.data.cat),
        };
        cachePoetCatalog(catalog, [cacheKey]);
        return catalog;
      })();

      poetCatalogPromiseCache[cacheKey] = request;
      return await request;
    } catch (error) {
      logger.error("Error fetching poet catalog by id:", error);
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        throw new Error("شاعر مورد نظر یافت نشد");
      }
      throw new Error("متأسفانه در دریافت اطلاعات شاعر مشکلی پیش آمد");
    } finally {
      delete poetCatalogPromiseCache[`id:${poetId}`];
    }
  },

  async getPoetCatalog(
    slug: string,
    poetId?: number,
  ): Promise<GanjoorPoetCatalog> {
    try {
      const normalizedPoetId =
        typeof poetId === "number" && Number.isInteger(poetId) && poetId > 0
          ? poetId
          : 0;
      const cacheKeys = [
        slug,
        normalizedPoetId > 0 ? `id:${normalizedPoetId}` : "",
      ].filter(Boolean);
      const cachedCatalog = getCachedPoetCatalog(cacheKeys);
      if (cachedCatalog) {
        return cachedCatalog;
      }

      if (normalizedPoetId > 0) {
        const catalog = await ganjoorApi.getPoetCatalogById(normalizedPoetId);
        if (!catalog.poet.urlSlug || catalog.poet.urlSlug === slug) {
          if (catalog.poet.urlSlug) {
            poetCache[catalog.poet.urlSlug] = catalog.poet;
          }
          poetCache[slug] = catalog.poet;
          cachePoetCatalog(catalog, [slug]);
          return catalog;
        }
      }

      const poet = await ganjoorApi.getPoetBySlug(slug);
      const catalog = await ganjoorApi.getPoetCatalogById(poet.id);
      if (catalog.poet.urlSlug) {
        poetCache[catalog.poet.urlSlug] = catalog.poet;
      }
      poetCache[slug] = catalog.poet;
      cachePoetCatalog(catalog, [slug]);
      return catalog;
    } catch (error) {
      logger.error("Error fetching poet catalog:", error);
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        throw new Error("شاعر مورد نظر یافت نشد");
      }
      throw new Error("متأسفانه در دریافت اطلاعات شاعر مشکلی پیش آمد");
    }
  },

  async getPoetBySlug(slug: string): Promise<Poet> {
    if (poetCache[slug]) {
      return poetCache[slug];
    }

    const response = await ganjoorHttp.get(
      `${API_BASE_URL}/api/ganjoor/poet?url=/${slug}`,
      {
        timeout: API_TIMEOUT_MS,
        headers: {
          Accept: "application/json",
        },
      },
    );
    const poet = ganjoorApi.mapPoetResponse(response.data);
    poetCache[slug] = poet;
    return poet;
  },

  async getCategoryWithPoems(
    categoryId: number,
    { includeMainSections = false }: { includeMainSections?: boolean } = {},
  ): Promise<GanjoorCategory> {
    try {
      const response = await ganjoorHttp.get(
        `${API_BASE_URL}/api/ganjoor/cat/${categoryId}`,
        {
          timeout: API_TIMEOUT_MS,
          params: {
            poems: true,
            mainSections: includeMainSections,
          },
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        },
      );
      return helpers.mapCategory(response.data.cat);
    } catch (error) {
      logger.error("Error fetching category poems:", error);
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        throw new Error("مجموعهٔ درخواستی یافت نشد");
      }
      throw new Error("متأسفانه در دریافت مجموعهٔ اشعار مشکلی پیش آمد");
    }
  },

  async getPoemByUrl(url: string): Promise<Poem> {
    const response = await ganjoorHttp.get(
      `${API_BASE_URL}/api/ganjoor/poem?url=${url}`,
      {
        timeout: API_TIMEOUT_MS,
        headers: {
          Accept: "application/json",
        },
      },
    );
    return ganjoorApi.mapPoemResponse(response.data);
  },

  async getPoemIdByUrl(url: string): Promise<number> {
    const poem = await this.getPoemByUrl(url);
    return poem.id;
  },

  async getQuotedPoems(
    poemId: number,
    { itemsCount = 8 }: { itemsCount?: number } = {},
  ): Promise<GanjoorQuotedPoem[]> {
    try {
      if (!Number.isInteger(poemId) || poemId < 1) {
        return [];
      }

      const response = await ganjoorHttp.get(
        `${API_BASE_URL}/api/ganjoor/poem/${poemId}/quoteds`,
        {
          timeout: API_TIMEOUT_MS,
          params: {
            itemsCount,
            published: true,
            chosenForMainList: true,
          },
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        },
      );

      return Array.isArray(response.data)
        ? response.data.map((item: any) => ({
            id: String(item?.id ?? ""),
            poemId: item?.poemId ?? poemId,
            relatedPoemId: item?.relatedPoemId ?? null,
            cachedRelatedPoemPoetName: item?.cachedRelatedPoemPoetName ?? null,
            cachedRelatedPoemFullTitle: item?.cachedRelatedPoemFullTitle ?? null,
            cachedRelatedPoemFullUrl: item?.cachedRelatedPoemFullUrl ?? null,
            cachedRelatedPoemPoetUrl: item?.cachedRelatedPoemPoetUrl ?? null,
            cachedRelatedPoemPoetImage:
              item?.cachedRelatedPoemPoetImage ?? null,
            coupletVerse1: item?.coupletVerse1 ?? null,
            coupletVerse2: item?.coupletVerse2 ?? null,
            relatedCoupletVerse1: item?.relatedCoupletVerse1 ?? null,
            relatedCoupletVerse2: item?.relatedCoupletVerse2 ?? null,
            poem: item?.poem ?? null,
          }))
        : [];
    } catch (error) {
      logger.error("Error fetching quoted poems:", error);
      return [];
    }
  },

  async getCategoryGeoTags(categoryId: number): Promise<PoemGeoDateTag[]> {
    try {
      if (!Number.isInteger(categoryId) || categoryId < 1) {
        return [];
      }

      const response = await ganjoorHttp.get(
        `${API_BASE_URL}/api/ganjoor/cat/${categoryId}/geotag`,
        {
          timeout: API_TIMEOUT_MS,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        },
      );

      return Array.isArray(response.data)
        ? response.data
            .map((tag: any) => ({
              id: tag?.id ?? 0,
              poemId: tag?.poemId ?? 0,
              coupletIndex: tag?.coupletIndex ?? 0,
              locationId: tag?.locationId ?? null,
              location: tag?.location
                ? {
                    id: tag.location.id ?? 0,
                    name: tag.location.name ?? null,
                    latitude: Number(tag.location.latitude) || 0,
                    longitude: Number(tag.location.longitude) || 0,
                    machineGenerated: Boolean(tag.location.machineGenerated),
                  }
                : null,
            }))
            .filter((tag) => tag.location)
        : [];
    } catch (error) {
      logger.error("Error fetching category geo tags:", error);
      return [];
    }
  },

  collectPoemIdsFromCategory,

  uniqueGeoLocations,

  async getRecitationVerses(recitationId: number): Promise<VerseSync[]> {
    try {
      if (isNaN(recitationId) || recitationId < 1) {
        throw new Error("شناسه خوانش معتبر نیست");
      }

      const response = await ganjoorHttp.get(
        `${API_BASE_URL}/api/audio/verses/${recitationId}`,
        {
          timeout: API_TIMEOUT_MS,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        },
      );

      return response.data.map((verse: any) => ({
        verseOrder: verse.verseOrder,
        verseText: verse.verseText,
        audioStartMilliseconds: verse.audioStartMilliseconds,
      }));
    } catch (error) {
      logger.error("Error fetching recitation verses:", error);
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          throw new Error("متأسفانه اطلاعات همزمان‌سازی این خوانش یافت نشد");
        }
        throw new Error("متأسفانه در دریافت اطلاعات همزمان‌سازی مشکلی پیش آمد");
      }
      throw error;
    }
  },

  mapPoemResponse,
};

export default ganjoorApi;
