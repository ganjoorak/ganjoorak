import { access } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getCategory } from "@/lib/echolaliaStore";

// Fallback image for an Echolalia poet: the image shipped in public/images/poets, else the default.
// (Poets normally link their local image directly; this covers ones the poet index doesn't know.)

const redirectTo = (imagePath: string, requestUrl: string) => {
  const response = NextResponse.redirect(new URL(imagePath, requestUrl));
  response.headers.set("Cache-Control", "public, max-age=86400");
  return response;
};

const decodeSlug = (slug: string) => {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ categoryId: string }> },
) {
  const categoryId = Number((await params).categoryId);
  const category = Number.isInteger(categoryId) && categoryId > 0 ? await getCategory(categoryId).catch(() => null) : null;

  if (category) {
    const fileName = `echolalia-${decodeSlug(category.slug)}.jpg`;
    try {
      await access(path.join(process.cwd(), "public", "images", "poets", fileName));
      return redirectTo(`/images/poets/${encodeURIComponent(fileName)}`, request.url);
    } catch {
      // No local image for this poet.
    }
  }

  return redirectTo("/images/default-poet.png", request.url);
}
