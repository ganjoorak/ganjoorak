#!/usr/bin/env node
// Builds public/data/poem-index.json: every published Ganjoor poet with the IDs
// of all their poems, stored as [start, length] runs. The «همه» feed uses it to
// pick a poet weighted by poem count and then a poem uniformly, because
// Ganjoor's /poem/random only covers a fixed list of ~18 poets.
//
// Usage: node scripts/build-poem-index.mjs [--concurrency 6]

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const API = process.env.GANJOOR_API_BASE_URL?.replace(/\/+$/, "") || "https://api.ganjoor.net";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "data", "poem-index.json");
const flagIndex = process.argv.indexOf("--concurrency");
const CONCURRENCY = flagIndex > 0 ? Number(process.argv[flagIndex + 1]) || 6 : 6;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url, attempt = 1) {
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (attempt >= 4) throw new Error(`${url}: ${error.message}`);
    await sleep(500 * 2 ** attempt);
    return getJson(url, attempt + 1);
  }
}

// Minimal promise pool so the crawl stays polite.
async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index], index);
      }
    }),
  );
  return results;
}

async function collectPoemIds(poet) {
  const ids = new Set();
  const root = await getJson(`${API}/api/ganjoor/poet/${poet.id}?catPoems=true`);
  const queue = [];
  const visit = (cat) => {
    for (const poem of cat?.poems ?? []) ids.add(poem.id);
    for (const child of cat?.children ?? []) queue.push(child.id);
  };
  visit(root.cat);
  while (queue.length > 0) {
    const batch = queue.splice(0, CONCURRENCY);
    const cats = await Promise.all(
      batch.map((id) => getJson(`${API}/api/ganjoor/cat/${id}?poems=true&mainSections=false`)),
    );
    cats.forEach((data) => visit(data.cat));
  }
  return [...ids].sort((a, b) => a - b);
}

const toRuns = (sortedIds) => {
  const runs = [];
  for (const id of sortedIds) {
    const last = runs.length - 2;
    if (last >= 0 && runs[last] + runs[last + 1] === id) runs[last + 1] += 1;
    else runs.push(id, 1);
  }
  return runs;
};

const poets = await getJson(`${API}/api/ganjoor/poets`);
console.log(`${poets.length} poets`);

let done = 0;
const entries = await mapPool(poets, 2, async (poet) => {
  const ids = await collectPoemIds(poet);
  done += 1;
  console.log(`[${done}/${poets.length}] ${poet.fullUrl} ${ids.length}`);
  return { id: poet.id, slug: poet.fullUrl.replace(/^\//, ""), count: ids.length, runs: toRuns(ids) };
});

const index = {
  generatedAt: new Date().toISOString(),
  poets: entries.filter((entry) => entry.count > 0),
};
await writeFile(OUT, `${JSON.stringify(index)}\n`);
const total = index.poets.reduce((sum, entry) => sum + entry.count, 0);
console.log(`wrote ${OUT}: ${index.poets.length} poets, ${total} poems`);
