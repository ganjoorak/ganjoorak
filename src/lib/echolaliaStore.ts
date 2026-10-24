// Server-only: the local mirror of Echolalia (data/echolalia, written by scripts/scrape-echolalia.mjs),
// shaped like the WordPress REST API that EcholaliaApi already speaks. Served at /api/echolalia/wp/*.

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export interface WpCategory {
  id: number;
  name: string;
  slug: string;
  count: number;
  parent: number;
  link: string;
  description: string;
}

export interface WpPost {
  id: number;
  date: string;
  modified: string;
  slug: string;
  link: string;
  title: { rendered: string };
  content: { rendered: string };
  excerpt: { rendered: string };
  categories: number[];
  featured_media: number;
}

interface ScrapedPoet extends WpCategory {
  group: string | null;
}

interface ScrapedPoem {
  id: number;
  date: string;
  modified: string;
  slug: string;
  link: string;
  title: string;
  content: string;
  excerpt: string;
  categories: number[];
  featuredMedia: number | null;
}

interface Store {
  categories: WpCategory[];
  categoryById: Map<number, WpCategory>;
  posts: WpPost[];
  postById: Map<number, WpPost>;
  searchText: Map<number, { title: string; body: string }>;
}

const DATA_DIR = path.join(process.cwd(), "data", "echolalia");
// The «شعر» root category on echolalia.ir; every poet group hangs off it.
const ROOT_CATEGORY: WpCategory = {
  id: 7,
  name: "شعر",
  slug: "sher",
  count: 0,
  parent: 0,
  link: "https://echolalia.ir/category/sher/",
  description: "",
};

const decodeSlug = (slug: string) => {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
};

// Loose matching for search: ignore case, diacritics, ZWNJ and Arabic/Persian letter variants.
export const normalizeForSearch = (value: string) =>
  value
    .toLowerCase()
    .replace(/[ً-ٰٟ]/g, "")
    .replace(/[‌‏‎]/g, " ")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/ة/g, "ه")
    .replace(/[إأآ]/g, "ا")
    .replace(/\s+/g, " ")
    .trim();

const stripHtml = (html: string) => html.replace(/<[^>]+>/g, " ");

let storeLoad: Promise<Store> | null = null;

const loadStore = (): Promise<Store> => {
  storeLoad ??= (async () => {
    const { poets } = JSON.parse(await readFile(path.join(DATA_DIR, "poets.json"), "utf8")) as {
      poets: ScrapedPoet[];
    };
    const groups = new Map<number, WpCategory>();
    for (const poet of poets) {
      if (!groups.has(poet.parent)) {
        groups.set(poet.parent, {
          id: poet.parent,
          name: poet.group ?? "",
          slug: `group-${poet.parent}`,
          count: 0,
          parent: ROOT_CATEGORY.id,
          link: "",
          description: "",
        });
      }
    }
    const categories: WpCategory[] = [
      ROOT_CATEGORY,
      ...Array.from(groups.values()),
      ...poets.map(({ id, name, slug, count, parent, link, description }) => ({
        id,
        name,
        slug,
        count,
        parent,
        link,
        description: description ?? "",
      })),
    ];

    const files = (await readdir(path.join(DATA_DIR, "poems"))).filter((file) => file.endsWith(".json"));
    const posts: WpPost[] = [];
    for (const file of files) {
      const { poems } = JSON.parse(await readFile(path.join(DATA_DIR, "poems", file), "utf8")) as {
        poems: ScrapedPoem[];
      };
      for (const poem of poems) {
        posts.push({
          id: poem.id,
          date: poem.date,
          modified: poem.modified,
          slug: poem.slug,
          link: poem.link,
          title: { rendered: poem.title },
          content: { rendered: poem.content },
          excerpt: { rendered: poem.excerpt },
          categories: poem.categories,
          featured_media: poem.featuredMedia ?? 0,
        });
      }
    }
    // WordPress lists newest first.
    posts.sort((a, b) => b.date.localeCompare(a.date));

    return {
      categories,
      categoryById: new Map(categories.map((category) => [category.id, category])),
      posts,
      postById: new Map(posts.map((post) => [post.id, post])),
      searchText: new Map(
        posts.map((post) => [
          post.id,
          {
            title: normalizeForSearch(stripHtml(post.title.rendered)),
            body: normalizeForSearch(stripHtml(post.content.rendered)),
          },
        ]),
      ),
    };
  })().catch((error) => {
    storeLoad = null;
    throw error;
  });
  return storeLoad;
};

export const getCategories = async (filter: { slug?: string } = {}) => {
  const { categories } = await loadStore();
  if (!filter.slug) return categories;
  const wanted = decodeSlug(filter.slug).toLowerCase();
  return categories.filter((category) => decodeSlug(category.slug).toLowerCase() === wanted);
};

export const getCategory = async (id: number) => (await loadStore()).categoryById.get(id) ?? null;

export const getPost = async (id: number) => (await loadStore()).postById.get(id) ?? null;

export const getPosts = async (filter: { categories?: number[]; search?: string } = {}) => {
  const { posts, searchText } = await loadStore();
  let result = posts;
  if (filter.categories?.length) {
    const wanted = new Set(filter.categories);
    result = result.filter((post) => post.categories.some((id) => wanted.has(id)));
  }
  const query = filter.search ? normalizeForSearch(filter.search) : "";
  if (query) {
    // Like WordPress: every word must appear; title matches rank first.
    const words = query.split(" ");
    const scored = result
      .map((post) => {
        const text = searchText.get(post.id)!;
        if (!words.every((word) => text.title.includes(word) || text.body.includes(word))) return null;
        return { post, score: text.title.includes(query) ? 0 : words.every((word) => text.title.includes(word)) ? 1 : 2 };
      })
      .filter((entry): entry is { post: WpPost; score: number } => entry !== null);
    scored.sort((a, b) => a.score - b.score);
    result = scored.map((entry) => entry.post);
  }
  return result;
};
