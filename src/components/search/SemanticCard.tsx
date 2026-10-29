"use client";

import { memo } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { PoetAvatar } from "@/components/SearchHits";
import { pairSemanticVerses } from "@/utils/searchText";
import type { SemanticHit } from "@/components/search/semantic";

export const SemanticCard = memo(function SemanticCard({
  hit,
  index,
  onClick,
}: {
  hit: SemanticHit;
  index: number;
  onClick: () => void;
}) {
  const couplets = pairSemanticVerses(hit.verses).slice(0, 2);
  return (
    <motion.li
      layout="position"
      className="search-hit"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: Math.min(index * 0.03, 0.24) }}
    >
      <Link href={hit.href} className="search-hit-link" onClick={onClick}>
        <span className="search-hit-verse">
          {couplets.map((couplet) =>
            couplet.text ? (
              <span key={couplet.key} className="search-hit-line is-match">
                {couplet.text}
              </span>
            ) : (
              <span key={couplet.key} className="search-hit-couplet">
                <span className="search-hit-line is-match">{couplet.right}</span>
                <span className="search-hit-line">{couplet.left}</span>
              </span>
            ),
          )}
        </span>
        <span className="search-hit-meta">
          <PoetAvatar src={hit.avatarUrl} name={hit.poetName} size={22} />
          <span className="search-hit-crumb">
            <strong>{hit.poetName}</strong>
            {hit.collection && <span>{hit.collection}</span>}
            <span>{hit.title}</span>
          </span>
        </span>
      </Link>
    </motion.li>
  );
});
