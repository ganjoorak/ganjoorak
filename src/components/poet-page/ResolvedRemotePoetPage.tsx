"use client";

import { useEffect, useState } from "react";
import LoadingScreen from "@/components/LoadingScreen";
import ErrorScreen from "@/components/ErrorScreen";
import AppNotFound from "@/app/not-found";
import ganjoorApi from "@/api/GanjoorApi";
import echolaliaApi from "@/api/EcholaliaApi";
import { logger } from "@/utils/logger";
import GanjoorPoetPage from "@/components/poet-page/GanjoorPoetPage";
import EcholaliaPoetPage from "@/components/poet-page/EcholaliaPoetPage";

export default function ResolvedRemotePoetPage({
  slug,
  poetId,
}: {
  slug: string;
  poetId?: number;
}) {
  const [source, setSource] = useState<"ganjoor" | "echolalia" | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const resolvePoet = async () => {
      setLoading(true);
      setNotFound(false);
      setError(null);
      setSource(null);

      const [ganjoorResult, echolaliaResult] = await Promise.allSettled([
        ganjoorApi.getPoetCatalog(slug, poetId),
        echolaliaApi.getPoetBySlug(slug),
      ]);

      if (ganjoorResult.status === "fulfilled") {
        if (!cancelled) {
          setSource("ganjoor");
          setLoading(false);
        }
        return;
      }

      if (echolaliaResult.status === "fulfilled") {
        if (!cancelled) {
          setSource("echolalia");
          setLoading(false);
        }
        return;
      }

      if (cancelled) return;
      const ganjoorError = ganjoorResult.reason;
      const ganjoorWasNotFound =
        ganjoorError instanceof Error &&
        ganjoorError.message &&
        /یافت نشد/.test(ganjoorError.message);

      if (ganjoorError && !ganjoorWasNotFound) {
        logger.error("Error resolving poet source:", ganjoorError);
        setError(
          "متأسفانه در دریافت اطلاعات شاعر مشکلی پیش آمد. لطفاً دوباره تلاش کنید.",
        );
      } else {
        setNotFound(true);
      }

      if (!cancelled) {
        setLoading(false);
      }
    };

    resolvePoet();

    return () => {
      cancelled = true;
    };
  }, [slug, poetId, reloadKey]);

  if (loading) {
    return <LoadingScreen />;
  }

  if (error) {
    return (
      <ErrorScreen message={error} onRetry={() => setReloadKey((v) => v + 1)} />
    );
  }

  if (notFound || !source) {
    return <AppNotFound />;
  }

  if (source === "echolalia") {
    return <EcholaliaPoetPage poetSlug={slug} />;
  }

  return <GanjoorPoetPage slug={slug} poetId={poetId} />;
}
