import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { POEM_INTERESTS, sanitizeInterestKeys } from "../src/data/interests";

const dir = "public/data/interests";
const files = readdirSync(dir).filter((name) => name.endsWith(".json"));

// The rail labels must match the cluster files the feed reads at runtime.
assert.deepEqual(
  POEM_INTERESTS.map((interest) => interest.key).sort(),
  files.map((name) => name.replace(/\.json$/, "")).sort(),
);
for (const interest of POEM_INTERESTS) {
  const data = JSON.parse(readFileSync(`${dir}/${interest.key}.json`, "utf8"));
  assert.equal(data.label, interest.label, interest.key);
  assert.ok(data.poemIds.length > 0, interest.key);
  assert.equal(data.poetSlugs.length, data.poemIds.length, interest.key);
}

// Saved settings from the old query-based categories keep only keys that still exist.
assert.deepEqual(sanitizeInterestKeys(["love", "mystic", "wine", "love", 3]), ["love", "wine"]);

console.log("interest tests passed");
