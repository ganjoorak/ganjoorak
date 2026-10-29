"use client";

import { useParams, useSearchParams } from "next/navigation";
import AppNotFound from "@/app/not-found";
import { PoetSlug, isValidPoetSlug } from "@/types/poet";
import poetSourceIndex from "@/data/poet-source-index.json";
import GanjoorPoetPage from "@/components/poet-page/GanjoorPoetPage";
import EcholaliaPoetPage from "@/components/poet-page/EcholaliaPoetPage";
import CustomPoetPage from "@/components/poet-page/CustomPoetPage";
import ResolvedRemotePoetPage from "@/components/poet-page/ResolvedRemotePoetPage";

type RemotePoetSource = "ganjoor" | "echolalia";

interface PoetSourceIndexEntry {
  source: RemotePoetSource;
  id?: number | null;
  name?: string;
  sourceGroupName?: string | null;
}

const indexedPoetSources = poetSourceIndex.sourcesBySlug as Record<
  string,
  PoetSourceIndexEntry | undefined
>;
const isValidPoetRouteSlug = (slug: string) =>
  slug.length >= 2 && !/[/?#\\\u0000-\u001F\u007F]/.test(slug);

export default function PoetPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const poetSlug = (params?.poet as string) || "";
  const poetIdParam = searchParams.get("poetId");
  const forcedSource = searchParams.get("source");
  const parsedPoetId = poetIdParam ? Number(poetIdParam) : NaN;
  const poetId =
    Number.isInteger(parsedPoetId) && parsedPoetId > 0
      ? parsedPoetId
      : undefined;

  if (!isValidPoetRouteSlug(poetSlug)) {
    return <AppNotFound />;
  }

  if (isValidPoetSlug(poetSlug)) {
    return <CustomPoetPage poetSlug={poetSlug as PoetSlug} />;
  }

  if (forcedSource === "echolalia") {
    return <EcholaliaPoetPage poetSlug={poetSlug} />;
  }

  const indexedSource = indexedPoetSources[poetSlug];

  if (indexedSource?.source === "echolalia") {
    return <EcholaliaPoetPage poetSlug={poetSlug} />;
  }

  if (indexedSource?.source === "ganjoor") {
    const indexedPoetId =
      typeof indexedSource.id === "number" && indexedSource.id > 0
        ? indexedSource.id
        : poetId;

    return <GanjoorPoetPage slug={poetSlug} poetId={indexedPoetId} />;
  }

  return <ResolvedRemotePoetPage slug={poetSlug} poetId={poetId} />;
}
