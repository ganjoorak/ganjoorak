#!/usr/bin/env node
// Mirrors every Echolalia poet and poem (WordPress REST API) into data/echolalia/:
//   poets.json            – poet categories under «شعر» (the same set the app lists)
//   poems/<poet-slug>.json – every post in that poet's category, content as rendered HTML
// Done with Echolalia's permission. Re-running overwrites the files.
//
// Usage: node scripts/scrape-echolalia.mjs [--insecure]
//   --insecure  accept an invalid TLS certificate (echolalia.ir's expired on 2026-10-19).
//               Read-only public requests; leave it off once the certificate is renewed.

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const API = "https://echolalia.ir/wp-json/wp/v2";
const ROOT_SLUG = "sher";
const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "echolalia");
const CATEGORY_FIELDS = "id,name,slug,count,parent,link,description";
const POST_FIELDS = "id,date,modified,slug,link,title,content,excerpt,categories,featured_media";

if (process.argv.includes("--insecure")) {
  console.warn("! TLS certificate verification is OFF for this run (--insecure).");
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function get(pathAndQuery, attempt = 1) {
  try {
    const response = await fetch(`${API}${pathAndQuery}`, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { data: await response.json(), totalPages: Number(response.headers.get("x-wp-totalpages") ?? 1) };
  } catch (error) {
    if (attempt >= 4) throw new Error(`${pathAndQuery}: ${error.cause?.code ?? error.message}`);
    await sleep(500 * 2 ** attempt);
    return get(pathAndQuery, attempt + 1);
  }
}

async function getAllPages(pathAndQuery) {
  const separator = pathAndQuery.includes("?") ? "&" : "?";
  const first = await get(`${pathAndQuery}${separator}per_page=100&page=1`);
  const items = [...first.data];
  for (let page = 2; page <= first.totalPages; page += 1) {
    items.push(...(await get(`${pathAndQuery}${separator}per_page=100&page=${page}`)).data);
    await sleep(150);
  }
  return items;
}

const categories = await getAllPages(`/categories?_fields=${CATEGORY_FIELDS}`);
const root = categories.find((category) => category.slug === ROOT_SLUG);
if (!root) throw new Error(`No «${ROOT_SLUG}» category`);

const children = new Map();
for (const category of categories) {
  children.set(category.parent, [...(children.get(category.parent) ?? []), category]);
}
const descendants = [];
const walk = (id) => (children.get(id) ?? []).forEach((child) => (descendants.push(child), walk(child.id)));
walk(root.id);

// Same rule as EcholaliaApi.getPoets: leaf categories under «شعر» that have posts.
const poets = descendants
  .filter((category) => category.count > 0 && (children.get(category.id) ?? []).length === 0)
  .map((category) => ({
    ...category,
    group: categories.find((item) => item.id === category.parent)?.name ?? null,
  }))
  .sort((a, b) => a.name.localeCompare(b.name, "fa"));

console.log(`${poets.length} poets, ${poets.reduce((sum, poet) => sum + poet.count, 0)} posts expected`);
await mkdir(path.join(OUT_DIR, "poems"), { recursive: true });

let total = 0;
for (const [index, poet] of poets.entries()) {
  const posts = await getAllPages(`/posts?categories=${poet.id}&orderby=date&order=asc&_fields=${POST_FIELDS}`);
  const poems = posts.map((post) => ({
    id: post.id,
    date: post.date,
    modified: post.modified,
    slug: post.slug,
    link: post.link,
    title: post.title?.rendered ?? "",
    content: post.content?.rendered ?? "",
    excerpt: post.excerpt?.rendered ?? "",
    categories: post.categories,
    featuredMedia: post.featured_media || null,
  }));
  poet.scraped = poems.length;
  total += poems.length;
  await writeFile(
    path.join(OUT_DIR, "poems", `${poet.slug}.json`),
    `${JSON.stringify({ poet: { id: poet.id, slug: poet.slug, name: poet.name }, poems }, null, 2)}\n`,
  );
  console.log(`[${index + 1}/${poets.length}] ${poet.slug}: ${poems.length}/${poet.count}`);
  await sleep(200);
}

await writeFile(
  path.join(OUT_DIR, "poets.json"),
  `${JSON.stringify({ scrapedAt: new Date().toISOString(), source: API, poets }, null, 2)}\n`,
);
console.log(`wrote ${OUT_DIR}: ${poets.length} poets, ${total} poems`);
