import type { Poem, PoemRecitation } from "@/types/poem";
import type { Poet } from "@/types/poet";
import type {
  GanjoorPoemSummary,
  GanjoorCategory,
  GanjoorCategoryReference,
  GanjoorPoemSearchResult,
  GanjoorSemanticSearchResult,
  GanjoorSemanticVerse,
} from "@/types/ganjoor";
import { getIndexedPoetImageUrl } from "@/utils/poetImages";
import { API_BASE_URL, getAudioProxyUrl } from "@/api/ganjoor/client";

export const helpers = {
  getPoetName: (fullTitle: string): string => {
    const parts = fullTitle.split(" » ");
    return parts[0];
  },
  getPoetSlug: (fullUrl: string): string => {
    if (!fullUrl) return "";
    const cleanUrl = fullUrl.startsWith("/") ? fullUrl.substring(1) : fullUrl;
    const parts = cleanUrl.split("/");
    return parts[0] || "";
  },
  mapPoemSummary: (poem: any): GanjoorPoemSummary => ({
    id: poem?.id ?? 0,
    title: poem?.title ?? "",
    urlSlug: poem?.urlSlug ?? null,
    fullUrl: poem?.fullUrl ?? null,
    excerpt: poem?.excerpt ?? null,
    mainSections: poem?.mainSections ?? null,
  }),
  mapCategoryReference: (category: any): GanjoorCategoryReference => ({
    id: category?.id ?? 0,
    title: category?.title ?? "",
    urlSlug: category?.urlSlug ?? null,
    fullUrl: category?.fullUrl ?? "",
    tableOfContentsStyle: category?.tableOfContentsStyle ?? null,
    catType: category?.catType ?? null,
    description: category?.description ?? null,
    descriptionHtml: category?.descriptionHtml ?? null,
    published: category?.published ?? false,
    bookName: category?.bookName ?? null,
  }),
  mapCategory: (category: any): GanjoorCategory => {
    const base = helpers.mapCategoryReference(category);
    const children = Array.isArray(category?.children)
      ? category.children.map((child: any) => helpers.mapCategory(child))
      : [];
    const poems = Array.isArray(category?.poems)
      ? category.poems.map((poem: any) => helpers.mapPoemSummary(poem))
      : [];
    const ancestors = Array.isArray(category?.ancestors)
      ? category.ancestors.map((ancestor: any) =>
        helpers.mapCategoryReference(ancestor),
      )
      : [];

    return {
      ...base,
      children,
      poems,
      ancestors,
      next: category?.next ? helpers.mapCategoryReference(category.next) : null,
      previous: category?.previous
        ? helpers.mapCategoryReference(category.previous)
        : null,
      sumUpSubsGeoLocations: category?.sumUpSubsGeoLocations ?? false,
      mapName: category?.mapName ?? null,
      rImageId: category?.rImageId ?? null,
    };
  },
  mapSemanticVerse: (verse: any): GanjoorSemanticVerse => ({
    vOrder: Number(verse?.vOrder) || 0,
    position: typeof verse?.position === "string" ? verse.position : "",
    text: verse?.text ?? "",
  }),
  mapSemanticSearchResult: (poem: any): GanjoorSemanticSearchResult => {
    const fullTitle = poem?.fullTitle ?? "";
    const fullUrl = poem?.fullUrl ?? "";
    const fullTitleParts = fullTitle
      .split(" » ")
      .map((part: string) => part.trim())
      .filter(Boolean);

    return {
      poemId: poem?.poemId ?? poem?.id ?? 0,
      title: poem?.title ?? "",
      fullTitle,
      fullUrl,
      poemSummary: poem?.poemSummary ?? null,
      verses: Array.isArray(poem?.verses)
        ? poem.verses.map((verse: any) => helpers.mapSemanticVerse(verse))
        : [],
      score: Number(poem?.score) || 0,
      poetName: fullTitleParts[0] || helpers.getPoetName(fullTitle),
      poetSlug: helpers.getPoetSlug(fullUrl),
      bookTitle:
        fullTitleParts.length > 2
          ? fullTitleParts.slice(1, -1).join(" » ")
          : null,
    };
  },
  mapPoemSearchResult: (poem: any): GanjoorPoemSearchResult => {
    const fullTitle = poem?.fullTitle ?? "";
    const fullUrl = poem?.fullUrl ?? "";
    const fullTitleParts = fullTitle
      .split(" » ")
      .map((part: string) => part.trim())
      .filter(Boolean);
    const poetName = fullTitleParts[0] || helpers.getPoetName(fullTitle);
    const bookTitle =
      poem?.oldTag ||
      (fullTitleParts.length > 2
        ? fullTitleParts.slice(1, -1).join(" » ")
        : null);
    const bookUrl =
      poem?.oldTagPageUrl ||
      (fullUrl.split("/").filter(Boolean).length > 2
        ? `/${fullUrl.split("/").filter(Boolean).slice(0, -1).join("/")}`
        : null);

    return {
      id: poem?.id ?? 0,
      title: poem?.title ?? "",
      fullTitle,
      fullUrl,
      plainText: poem?.plainText ?? "",
      poemSummary: poem?.poemSummary ?? null,
      poetName,
      poetSlug: helpers.getPoetSlug(fullUrl),
      bookTitle,
      bookUrl,
    };
  },
};

export function mapPoetResponse(data: any): Poet {
  if (!data || !data.poet) {
    throw new Error("Invalid poet data");
  }
  const poet = data.poet;
  return {
    id: poet.id,
    name: poet.name,
    description: poet.description,
    fullUrl: poet.fullUrl,
    urlSlug: poet.fullUrl.startsWith("/")
      ? poet.fullUrl.slice(1)
      : poet.fullUrl,
    rootCatId: poet.rootCatId,
    nickname: poet.nickname,
    published: poet.published,
    imageUrl:
      getIndexedPoetImageUrl(
        "ganjoor",
        poet.fullUrl.startsWith("/") ? poet.fullUrl.slice(1) : poet.fullUrl,
      ) || `${API_BASE_URL}${poet.imageUrl}`,
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
  };
}

export function mapPoemResponse(data: any): Poem {
  if (!data || !data.id) {
    throw new Error("متأسفانه شعر مورد نظر یافت نشد");
  }

  // Map recitations to our type if available
  const recitations: PoemRecitation[] =
    data.recitations?.map((rec: any) => {
      const proxiedMp3Url = getAudioProxyUrl(rec.mp3Url);

      return {
        id: rec.id,
        poemId: rec.poemId,
        poemFullTitle: rec.poemFullTitle,
        poemFullUrl: rec.poemFullUrl,
        audioTitle: rec.audioTitle,
        audioArtist: rec.audioArtist,
        audioArtistUrl: rec.audioArtistUrl,
        audioSrc: proxiedMp3Url || rec.audioSrc,
        audioSrcUrl: proxiedMp3Url || rec.audioSrcUrl,
        legacyAudioGuid: rec.legacyAudioGuid,
        mp3FileCheckSum: rec.mp3FileCheckSum,
        mp3SizeInBytes: rec.mp3SizeInBytes,
        publishDate: rec.publishDate,
        fileLastUpdated: rec.fileLastUpdated,
        mp3Url: proxiedMp3Url || rec.mp3Url,
        xmlText: rec.xmlText,
        plainText: rec.plainText,
        htmlText: rec.htmlText,
        mistakes: rec.mistakes || [],
        audioOrder: rec.audioOrder,
        recitationType: rec.recitationType,
        inSyncWithText: rec.inSyncWithText,
        upVotedByUser: rec.upVotedByUser,
      };
    }) || [];

  // Clean up HTML text by removing unnecessary divs and keeping only meaningful structure
  const cleanHtml =
    data.htmlText
      ?.replace(/<div[^>]*class="([^"]*)"[^>]*>/g, "")
      .replace(/<\/div>/g, "")
      .replace(/<p[^>]*>/g, "")
      .replace(/<\/p>/g, "\n")
      .trim() || "";

  // Ganjoor marks prose paragraphs with <div class="n">, single centred
  // lines (stanza breaks like «***», tarjiband/tasnif band lines) with
  // <div class="b2">, and couplets with b + m1/m2. Record one kind per <p>
  // so the viewer pairs only real mesras.
  const lineKinds: Array<"verse" | "prose" | "centered"> = [];
  if (data.htmlText) {
    let block = "";
    const tokenRe = /<div[^>]*class="([^"]*)"[^>]*>|<p[^>]*>([\s\S]*?)<\/p>/g;
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(data.htmlText)) !== null) {
      if (m[1] !== undefined) {
        const cls = m[1].split(/\s+/);
        if (!cls.includes("m1") && !cls.includes("m2")) block = cls[0] || "";
      } else if ((m[2] ?? "").trim()) {
        lineKinds.push(block === "n" ? "prose" : block === "b2" ? "centered" : "verse");
      }
    }
  }

  const imgUrl = `${API_BASE_URL}/api/ganjoor/poet/image/${helpers.getPoetSlug(data.fullUrl)}.gif`;

  return {
    id: data.id,
    title: data.title || "Unknown Title",
    fullTitle: data.fullTitle || "",
    urlSlug: data.urlSlug || "",
    fullUrl: data.fullUrl || "",
    plainText: cleanHtml || data.plainText,
    htmlText: cleanHtml || "",
    ...(lineKinds.some((kind) => kind !== "verse") ? { lineKinds } : {}),
    recitations: recitations,
    poet: helpers.getPoetName(data.fullTitle),
    poetSlug: helpers.getPoetSlug(data.fullUrl),
    poetNickname: helpers.getPoetName(data.fullUrl),
    poetImageUrl: imgUrl,
    source: "ganjoor",
  };
}
