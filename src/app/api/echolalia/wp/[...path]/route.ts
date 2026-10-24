import { NextResponse } from "next/server";
import { getCategories, getCategory, getPost, getPosts } from "@/lib/echolaliaStore";
import { logger } from "@/utils/logger";

// The subset of Echolalia's WordPress REST API (wp-json/wp/v2) that EcholaliaApi uses, answered from
// the local mirror: categories[?slug], categories/:id, posts[?categories&search], posts/:id, with
// per_page/page paging, X-WP-Total(Pages) headers and top-level _fields.

const CACHE_HEADERS = { "Cache-Control": "public, max-age=3600, s-maxage=86400" };

const pickFields = <T extends object>(item: T, fields: string | null) => {
  if (!fields) return item;
  const keys = new Set(fields.split(",").map((field) => field.trim().split(".")[0]));
  return Object.fromEntries(Object.entries(item).filter(([key]) => keys.has(key)));
};

const notFound = () =>
  NextResponse.json({ code: "rest_no_route", message: "Not found", data: { status: 404 } }, { status: 404 });

const paged = <T extends object>(items: T[], params: URLSearchParams) => {
  const perPage = Math.min(Math.max(Number(params.get("per_page")) || 10, 1), 100);
  const page = Math.max(Number(params.get("page")) || 1, 1);
  const totalPages = Math.max(Math.ceil(items.length / perPage), 1);
  const fields = params.get("_fields");
  return NextResponse.json(
    items.slice((page - 1) * perPage, page * perPage).map((item) => pickFields(item, fields)),
    {
      headers: {
        ...CACHE_HEADERS,
        "X-WP-Total": String(items.length),
        "X-WP-TotalPages": String(totalPages),
      },
    },
  );
};

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const [resource, idParam, ...rest] = (await params).path;
  const query = new URL(request.url).searchParams;
  const fields = query.get("_fields");

  try {
    if (rest.length > 0) return notFound();

    if (resource === "categories") {
      if (idParam) {
        const category = await getCategory(Number(idParam));
        return category ? NextResponse.json(pickFields(category, fields), { headers: CACHE_HEADERS }) : notFound();
      }
      return paged(await getCategories({ slug: query.get("slug") ?? undefined }), query);
    }

    if (resource === "posts") {
      if (idParam) {
        const post = await getPost(Number(idParam));
        return post ? NextResponse.json(pickFields(post, fields), { headers: CACHE_HEADERS }) : notFound();
      }
      const categories = (query.get("categories") ?? "")
        .split(",")
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0);
      return paged(await getPosts({ categories, search: query.get("search") ?? undefined }), query);
    }

    return notFound();
  } catch (error) {
    logger.error("Echolalia mirror failed:", error);
    return NextResponse.json({ code: "mirror_error", message: "Echolalia data unavailable" }, { status: 500 });
  }
}
