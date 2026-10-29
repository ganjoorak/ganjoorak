"use client";

import { forwardRef, memo, useMemo, useState, type MouseEventHandler } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import PoetPlaceholder from "@/components/PoetPlaceholder";
import type { DirectoryPoet } from "@/utils/poetDirectory";
import { getDirectoryPoetDisplayName } from "@/utils/poetDirectory";
import { isPlaceholderPoetImage } from "@/utils/poetImages";
import type { PoemLibrarySource } from "@/utils/poemLibrary";
import { getPoetHref } from "@/utils/searchClient";
import { highlightRanges, parseQuery, type PoemHit } from "@/utils/searchMatch";
import "@/styles/searchStyles";

/** Result rows shared by the search page, the search dialog and the poet page's search panel. */

export const SOURCE_LABELS: Record<PoemLibrarySource, string> = {
  ganjoor: "گنجور",
  custom: "محلی",
  echolalia: "اکولالیا",
};

export const Highlighted = memo(function Highlighted({ text, query }: { text: string; query: string }) {
  const parts = useMemo(() => {
    const ranges = highlightRanges(text, parseQuery(query));
    const out: Array<{ text: string; mark: boolean }> = [];
    let at = 0;
    ranges.forEach((range) => {
      if (range.start > at) out.push({ text: text.slice(at, range.start), mark: false });
      out.push({ text: text.slice(range.start, range.end), mark: true });
      at = range.end;
    });
    if (at < text.length) out.push({ text: text.slice(at), mark: false });
    return out;
  }, [query, text]);

  return (
    <>
      {parts.map((part, index) =>
        part.mark ? (
          <mark key={index} className="search-highlight">
            {part.text}
          </mark>
        ) : (
          part.text
        ),
      )}
    </>
  );
});

export const PoetAvatar = memo(function PoetAvatar({
  src,
  name,
  size = 28,
}: {
  src: string | null;
  name: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed || isPlaceholderPoetImage(src)) {
    return <PoetPlaceholder seed={name} className="search-avatar" style={{ width: size, height: size }} />;
  }

  return (
    <Image
      src={src}
      alt=""
      width={size}
      height={size}
      className="search-avatar"
      onError={() => setFailed(true)}
    />
  );
});

/** The matching couplet, in reading order, with the match marked. */
export const HitVerse = ({ hit, query }: { hit: PoemHit; query: string }) => {
  const match = (
    <span className="search-hit-line is-match">
      <Highlighted text={hit.line} query={query} />
    </span>
  );
  const context = hit.context ? (
    <span className="search-hit-line">
      <Highlighted text={hit.context} query={query} />
    </span>
  ) : null;
  return (
    <span className="search-hit-verse">
      {hit.contextPosition === "before" ? (
        <>
          {context}
          {match}
        </>
      ) : (
        <>
          {match}
          {context}
        </>
      )}
    </span>
  );
};

interface HitCardProps {
  hit: PoemHit;
  query: string;
  index?: number;
  compact?: boolean;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
}

export const HitCard = memo(
  forwardRef<HTMLLIElement, HitCardProps>(function HitCard(
    { hit, query, index = 0, compact = false, onClick },
    ref,
  ) {
    return (
      <motion.li
        ref={ref}
        layout="position"
        className={`search-hit${compact ? " is-compact" : ""}`}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, transition: { duration: 0.12 } }}
        transition={{
          duration: 0.22,
          ease: [0.2, 0.7, 0.2, 1],
          delay: Math.min(index * 0.025, 0.2),
          layout: { duration: 0.28, ease: [0.2, 0.7, 0.2, 1] },
        }}
      >
        <Link href={hit.href} className="search-hit-link" onClick={onClick}>
          <HitVerse hit={hit} query={query} />
          <span className="search-hit-meta">
            <PoetAvatar src={hit.avatarUrl} name={hit.poetName} size={compact ? 20 : 22} />
            <span className="search-hit-crumb">
              <strong>{hit.poetName}</strong>
              {hit.collection && !compact && <span>{hit.collection}</span>}
              <span>
                <Highlighted text={hit.title} query={query} />
              </span>
            </span>
            {hit.source !== "ganjoor" && (
              <span className={`search-hit-source is-${hit.source}`}>{SOURCE_LABELS[hit.source]}</span>
            )}
          </span>
        </Link>
      </motion.li>
    );
  }),
);

export const HitSkeleton = ({ compact = false }: { compact?: boolean }) => (
  <li className={`search-hit search-hit-skeleton${compact ? " is-compact" : ""}`} aria-hidden="true">
    <span className="search-skeleton-line long" />
    <span className="search-skeleton-line medium" />
    <span className="search-skeleton-meta">
      <span className="search-skeleton-dot" />
      <span className="search-skeleton-line short" />
    </span>
  </li>
);

export const PoetPill = memo(function PoetPill({
  poet,
  query,
  onClick,
}: {
  poet: DirectoryPoet;
  query: string;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
}) {
  const name = getDirectoryPoetDisplayName(poet);
  return (
    <Link href={getPoetHref(poet)} className="search-poet-pill" onClick={onClick}>
      <PoetAvatar src={poet.imageUrl} name={name} size={36} />
      <span className="search-poet-pill-text">
        <strong>
          <Highlighted text={name} query={query} />
        </strong>
        <small>
          {poet.nickname && poet.nickname !== poet.name ? poet.name : SOURCE_LABELS[poet.source]}
        </small>
      </span>
    </Link>
  );
});
