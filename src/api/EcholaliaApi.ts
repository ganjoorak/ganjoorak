import axios from "axios";
import type { Poem } from "@/types/poem";
import { createPoet, type Poet } from "@/types/poet";
import { logger } from "@/utils/logger";
import { getIndexedPoetImageUrl } from "@/utils/poetImages";

// Our own mirror of echolalia.ir's WordPress REST API (src/app/api/echolalia/wp), served from data/echolalia.
const ECHOLALIA_API_BASE_URL = "/api/echolalia/wp";
const ECHOLALIA_POET_ROOT_SLUG = "sher";
const HIDDEN_ECHOLALIA_POET_SLUGS = new Set(["forough-farrokhzad", "nosrat-rahmani"]);
const API_TIMEOUT_MS = 15000;

export interface EcholaliaCategory {
  id: number;
  count: number;
  link: string;
  name: string;
  slug: string;
  parent: number;
  description?: string;
}

interface EcholaliaPost {
  id: number;
  date: string;
  slug: string;
  link: string;
  title: {
    rendered: string;
  };
  content?: {
    rendered: string;
  };
  excerpt?: {
    rendered: string;
  };
  categories: number[];
  featured_media?: number;
}

export interface EcholaliaPoemSummary {
  id: number;
  title: string;
  slug: string;
  link: string;
  date: string;
}

export interface EcholaliaSearchPost {
  id: number;
  title: string;
  slug: string;
  link: string;
  plainText: string;
  excerpt: string;
  categoryIds: number[];
}

const echolaliaHttp = axios.create({
  proxy: false,
  timeout: API_TIMEOUT_MS,
  headers: {
    Accept: "application/json",
  },
});

const poetCache: Record<string, Poet | undefined> = {};
const poetPromiseCache: Record<string, Promise<Poet> | undefined> = {};
const poemSummaryCache: Record<string, EcholaliaPoemSummary[] | undefined> = {};
const poemSummaryPromiseCache: Record<
  string,
  Promise<EcholaliaPoemSummary[]> | undefined
> = {};

export const decodeWordPressSlug = (slug: string) => {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
};

export const decodeHtmlEntities = (value: string) => {
  const namedEntities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    hellip: "...",
    zwnj: "\u200c",
  };

  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(parseInt(code, 16)),
    )
    .replace(/&([a-z]+);/gi, (match, entity) => namedEntities[entity] ?? match);
};

export const htmlToPlainText = (html: string) =>
  decodeHtmlEntities(
    html
      .replace(/<div\s+class=["']sing-block["'][\s\S]*$/i, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n"),
  );

const mapPostToSummary = (post: EcholaliaPost): EcholaliaPoemSummary => ({
  id: post.id,
  title: decodeHtmlEntities(post.title?.rendered ?? ""),
  slug: post.slug,
  link: post.link,
  date: post.date,
});

const mapPostToSearchPost = (post: EcholaliaPost): EcholaliaSearchPost => {
  const title = decodeHtmlEntities(post.title?.rendered ?? "");
  const plainText = htmlToPlainText(post.content?.rendered ?? "");
  const excerpt =
    htmlToPlainText(post.excerpt?.rendered ?? "").split("\n")[0] ||
    plainText.split("\n")[0] ||
    title;
  return {
    id: post.id,
    title,
    slug: post.slug,
    link: post.link,
    plainText,
    excerpt,
    categoryIds: Array.isArray(post.categories) ? post.categories : [],
  };
};

const getPoetImageRoute = (categoryId: number) =>
  `/api/echolalia/poet-image/${categoryId}`;

export const isHiddenEcholaliaPoetSlug = (slug: string) =>
  HIDDEN_ECHOLALIA_POET_SLUGS.has(decodeWordPressSlug(slug));

const isHiddenEcholaliaPoetCategory = (category: EcholaliaCategory) =>
  isHiddenEcholaliaPoetSlug(category.slug);

const mapCategoryToPoet = (
  category: EcholaliaCategory,
  sourceGroupName?: string,
): Poet => {
  const slug = decodeWordPressSlug(category.slug);

  return createPoet({
    id: category.id,
    name: category.name,
    description: category.description || "اکولالیا - آرشیو شعر جهان",
    fullUrl: `/${slug}`,
    urlSlug: slug,
    rootCatId: category.id,
    nickname: null,
    published: true,
    imageUrl:
      getIndexedPoetImageUrl("echolalia", slug) ||
      getPoetImageRoute(category.id),
    source: "echolalia",
    sourceGroupName,
  });
};

/** Poets are the leaf categories under «شعر» that have posts. Shared with the server-rendered poets page. */
export const categoriesToPoets = (
  categories: EcholaliaCategory[],
  rootCategoryId: number,
): Poet[] => {
  const childrenByParent = new Map<number, EcholaliaCategory[]>();

  categories.forEach((category) => {
    const siblings = childrenByParent.get(category.parent) ?? [];
    siblings.push(category);
    childrenByParent.set(category.parent, siblings);
  });

  const descendantIds = new Set<number>();
  const collectDescendants = (parentId: number) => {
    (childrenByParent.get(parentId) ?? []).forEach((child) => {
      descendantIds.add(child.id);
      collectDescendants(child.id);
    });
  };
  collectDescendants(rootCategoryId);

  return categories
    .filter((category) => descendantIds.has(category.id))
    .filter((category) => category.count > 0)
    .filter(
      (category) => (childrenByParent.get(category.id) ?? []).length === 0,
    )
    .filter((category) => !isHiddenEcholaliaPoetCategory(category))
    .map((category) => {
      const parent = categories.find((item) => item.id === category.parent);
      return mapCategoryToPoet(category, parent?.name);
    })
    .sort((a, b) => a.name.localeCompare(b.name, "fa"));
};

const echolaliaApi = {
  async getPoets(): Promise<Poet[]> {
    try {
      const rootResponse = await echolaliaHttp.get<EcholaliaCategory[]>(
        `${ECHOLALIA_API_BASE_URL}/categories`,
        {
          params: {
            slug: ECHOLALIA_POET_ROOT_SLUG,
            _fields: "id,name,slug,count,parent,link,description",
          },
        },
      );
      const rootCategory = rootResponse.data[0];

      if (!rootCategory) {
        return [];
      }

      const firstPageResponse = await echolaliaHttp.get<EcholaliaCategory[]>(
        `${ECHOLALIA_API_BASE_URL}/categories`,
        {
          params: {
            per_page: 100,
            page: 1,
            _fields: "id,name,slug,count,parent,link,description",
          },
        },
      );
      const totalPages = Number(
        firstPageResponse.headers["x-wp-totalpages"] ?? 1,
      );
      const remainingPages =
        totalPages > 1
          ? await Promise.all(
              Array.from({ length: totalPages - 1 }, (_, index) =>
                echolaliaHttp.get<EcholaliaCategory[]>(
                  `${ECHOLALIA_API_BASE_URL}/categories`,
                  {
                    params: {
                      per_page: 100,
                      page: index + 2,
                      _fields: "id,name,slug,count,parent,link,description",
                    },
                  },
                ),
              ),
            )
          : [];

      return categoriesToPoets([
        ...firstPageResponse.data,
        ...remainingPages.flatMap((response) => response.data),
      ], rootCategory.id);
    } catch (error) {
      logger.error("Error fetching Echolalia poets:", error);
      return [];
    }
  },

  async getPoetBySlug(slug: string): Promise<Poet> {
    if (poetCache[slug]) {
      return poetCache[slug];
    }

    if (poetPromiseCache[slug]) {
      return await poetPromiseCache[slug];
    }

    const request = (async () => {
      const response = await echolaliaHttp.get<EcholaliaCategory[]>(
        `${ECHOLALIA_API_BASE_URL}/categories`,
        {
          params: {
            slug,
            _fields: "id,name,slug,count,parent,link,description",
          },
        },
      );
      const category = response.data[0];

      if (!category || category.count <= 0) {
        throw new Error("شاعر مورد نظر در اکولالیا پیدا نشد");
      }

      if (isHiddenEcholaliaPoetCategory(category)) {
        throw new Error("شاعر مورد نظر در اکولالیا پیدا نشد");
      }

      let sourceGroupName: string | undefined;
      if (category.parent) {
        try {
          const parentResponse = await echolaliaHttp.get<EcholaliaCategory>(
            `${ECHOLALIA_API_BASE_URL}/categories/${category.parent}`,
            {
              params: {
                _fields: "id,name,slug,count,parent,link,description",
              },
            },
          );
          sourceGroupName = parentResponse.data.name;
        } catch (error) {
          logger.warn("Could not fetch Echolalia poet parent category:", error);
        }
      }

      const poet = mapCategoryToPoet(category, sourceGroupName);
      poetCache[slug] = poet;
      poetCache[poet.urlSlug] = poet;
      return poet;
    })();

    poetPromiseCache[slug] = request;
    try {
      return await request;
    } finally {
      delete poetPromiseCache[slug];
    }
  },

  async getPoemsByPoetSlug(slug: string): Promise<EcholaliaPoemSummary[]> {
    if (poemSummaryCache[slug]) {
      return poemSummaryCache[slug];
    }

    if (poemSummaryPromiseCache[slug]) {
      return await poemSummaryPromiseCache[slug];
    }

    const request = (async () => {
    const poet = await echolaliaApi.getPoetBySlug(slug);
    const firstPageResponse = await echolaliaHttp.get<EcholaliaPost[]>(
      `${ECHOLALIA_API_BASE_URL}/posts`,
      {
        params: {
          categories: poet.rootCatId,
          per_page: 100,
          page: 1,
          _fields: "id,date,slug,link,title,categories",
        },
      },
    );
    const totalPages = Number(
      firstPageResponse.headers["x-wp-totalpages"] ?? 1,
    );
    const remainingPages =
      totalPages > 1
        ? await Promise.all(
            Array.from({ length: totalPages - 1 }, (_, index) =>
              echolaliaHttp.get<EcholaliaPost[]>(
                `${ECHOLALIA_API_BASE_URL}/posts`,
                {
                  params: {
                    categories: poet.rootCatId,
                    per_page: 100,
                    page: index + 2,
                    _fields: "id,date,slug,link,title,categories",
                  },
                },
              ),
            ),
          )
        : [];

    const summaries = [
      ...firstPageResponse.data,
      ...remainingPages.flatMap((response) => response.data),
    ].map(mapPostToSummary);
      poemSummaryCache[slug] = summaries;
      poemSummaryCache[poet.urlSlug] = summaries;
      return summaries;
    })();

    poemSummaryPromiseCache[slug] = request;
    try {
      return await request;
    } finally {
      delete poemSummaryPromiseCache[slug];
    }
  },

  async getPoemById(id: number): Promise<Poem> {
    const response = await echolaliaHttp.get<EcholaliaPost>(
      `${ECHOLALIA_API_BASE_URL}/posts/${id}`,
      {
        params: {
          _fields: "id,date,slug,link,title,content,excerpt,categories",
        },
      },
    );
    const post = response.data;
    const poetCategoryId = post.categories[0];
    const poetResponse = await echolaliaHttp.get<EcholaliaCategory>(
      `${ECHOLALIA_API_BASE_URL}/categories/${poetCategoryId}`,
      {
        params: {
          _fields: "id,name,slug,count,parent,link,description",
        },
      },
    );
    const poet = mapCategoryToPoet(poetResponse.data);
    if (isHiddenEcholaliaPoetSlug(poet.urlSlug)) {
      throw new Error("شعر مورد نظر در اکولالیا پیدا نشد");
    }

    const title = decodeHtmlEntities(post.title?.rendered ?? "");
    const plainText = htmlToPlainText(post.content?.rendered ?? "");

    return {
      id: post.id,
      title,
      fullTitle: `${poet.name} » ${title}`,
      poet: poet.name,
      poetNickname: "",
      poetSlug: poet.urlSlug,
      poetImageUrl: poet.imageUrl,
      urlSlug: post.slug,
      fullUrl: post.link,
      plainText,
      htmlText: plainText,
      recitations: [],
      isCustom: true,
      source: "echolalia",
    };
  },

  async getRandomPoemByPoetSlug(slug: string): Promise<Poem> {
    const poems = await echolaliaApi.getPoemsByPoetSlug(slug);
    if (!poems.length) {
      throw new Error("شعری برای این شاعر پیدا نشد");
    }
    const poem = poems[Math.floor(Math.random() * poems.length)];
    return echolaliaApi.getPoemById(poem.id);
  },

  /**
   * Single-request search that returns the post text as-is (no per-result
   * follow-up requests). Callers resolve poets from `categoryIds` themselves.
   */
  async searchPosts(
    query: string,
    {
      pageSize = 12,
      categoryId,
      signal,
    }: { pageSize?: number; categoryId?: number; signal?: AbortSignal } = {},
  ): Promise<EcholaliaSearchPost[]> {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2) {
      return [];
    }

    const response = await echolaliaHttp.get<EcholaliaPost[]>(
      `${ECHOLALIA_API_BASE_URL}/posts`,
      {
        signal,
        params: {
          search: normalizedQuery,
          per_page: pageSize,
          ...(categoryId && categoryId > 0 ? { categories: categoryId } : {}),
          _fields: "id,slug,link,title,content,excerpt,categories",
        },
      },
    );

    return (Array.isArray(response.data) ? response.data : []).map(
      mapPostToSearchPost,
    );
  },

  async searchPoemsByPoetSlug(
    slug: string,
    query: string,
    { signal }: { signal?: AbortSignal } = {},
  ): Promise<
    Array<{
      id: number;
      title: string;
      excerpt: string;
      collection: string | null;
    }>
  > {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2) {
      return [];
    }

    const poet = await echolaliaApi.getPoetBySlug(slug);
    const response = await echolaliaHttp.get<EcholaliaPost[]>(
      `${ECHOLALIA_API_BASE_URL}/posts`,
      {
        signal,
        params: {
          search: normalizedQuery,
          categories: poet.rootCatId,
          per_page: 12,
          _fields: "id,date,slug,link,title,content,excerpt,categories",
        },
      },
    );

    return response.data.map((post) => {
      const title = decodeHtmlEntities(post.title?.rendered ?? "");
      const plainText = htmlToPlainText(post.content?.rendered ?? "");
      return {
        id: post.id,
        title,
        excerpt:
          decodeHtmlEntities(post.excerpt?.rendered ?? "") ||
          plainText.split("\n").map((line) => line.trim()).find(Boolean) ||
          title,
        collection: null,
      };
    });
  },

  async searchPoems(
    query: string,
    { pageSize = 8, signal }: { pageSize?: number; signal?: AbortSignal } = {},
  ): Promise<Poem[]> {
    const response = await echolaliaHttp.get<EcholaliaPost[]>(
      `${ECHOLALIA_API_BASE_URL}/posts`,
      {
        signal,
        params: {
          search: query,
          per_page: pageSize,
          _fields: "id,date,slug,link,title,content,excerpt,categories",
        },
      },
    );
    const results = await Promise.allSettled(
      response.data.map((post) => echolaliaApi.getPoemById(post.id)),
    );

    return results
      .filter((result): result is PromiseFulfilledResult<Poem> => {
        if (result.status === "fulfilled") {
          return true;
        }

        logger.warn("Skipping Echolalia search result:", result.reason);
        return false;
      })
      .map((result) => result.value);
  },
};

export default echolaliaApi;
