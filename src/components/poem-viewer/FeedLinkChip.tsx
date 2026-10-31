"use client";

import Link from "next/link";
import { FaHome } from "react-icons/fa";
import type { Poem } from "@/types/poem";
import { handOffPoemToFeed } from "@/utils/feedCache";

/** On a single poem: goes to the home feed, which opens on this poem and scrolls on from it. */
export default function FeedLinkChip({ poem }: { poem: Poem }) {
  return (
    <Link href="/" className="poem-eyebrow-chip" onClick={() => handOffPoemToFeed(poem)}>
      <FaHome aria-hidden="true" />
      ادامه در صفحهٔ اصلی
    </Link>
  );
}
