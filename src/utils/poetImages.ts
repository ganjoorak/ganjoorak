import poetSourceIndex from "@/data/poet-source-index.json";

type PoetImageSource = "ganjoor" | "echolalia";

interface PoetImageIndexEntry {
  source: PoetImageSource;
  localImageUrl?: string;
}

const sourcesBySlug = poetSourceIndex.sourcesBySlug as Record<
  string,
  PoetImageIndexEntry | undefined
>;

export const getIndexedPoetImageUrl = (
  source: PoetImageSource,
  slug?: string | null,
) => {
  if (!slug) {
    return null;
  }

  const entry = sourcesBySlug[slug];
  if (entry?.source !== source || !entry.localImageUrl) {
    return null;
  }

  return entry.localImageUrl;
};

// Poets whose source has no portrait: Ganjoor serves a black turban silhouette and
// Echolalia a "no image" icon. The app draws its own placeholder for them instead
// (PoetPlaceholder). Found as byte-identical files in public/images/poets.
const PLACEHOLDER_GANJOOR_SLUGS = new Set([
  "abolala", "abolhoseyn", "abolmoayyed", "abueshagh", "balami", "barmaki", "bolmasal",
  "daye", "eshraghb", "fanoodi", "faralavi", "jamal", "jeyhoon", "kashi", "mahabadi",
  "masoudi", "moradi", "mosabi", "rownaghi", "saghir", "sane", "sepehri", "shahid",
  "shaker", "soghdi", "soozani", "tokhari",
]);
const PLACEHOLDER_ECHOLALIA_SLUGS = new Set(["ilva-macky", "nuna-bugvsyan", "rebbeca-ndjoze"]);

/** True when a poet image URL is missing, broken or one of the sources' placeholders. */
export const isPlaceholderPoetImage = (url?: string | null) => {
  if (!url || url.endsWith("/default-poet.png")) {
    return true;
  }
  const path = url.split("?")[0];
  let file = path.slice(path.lastIndexOf("/") + 1);
  try {
    file = decodeURIComponent(file);
  } catch {
    // keep the raw name
  }
  const local = file.match(/^(ganjoor|echolalia)-(.+)\.(gif|jpe?g|png|webp)$/i);
  if (local) {
    return local[1] === "ganjoor"
      ? PLACEHOLDER_GANJOOR_SLUGS.has(local[2])
      : PLACEHOLDER_ECHOLALIA_SLUGS.has(local[2]);
  }
  // Ganjoor's own image endpoint: /api/ganjoor/poet/image/<slug>.gif
  const remote = path.match(/\/poet\/image\/([^/]+)\.gif$/i);
  return Boolean(remote && PLACEHOLDER_GANJOOR_SLUGS.has(remote[1]));
};
