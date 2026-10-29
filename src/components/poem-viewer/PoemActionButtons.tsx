"use client";

import Link from "next/link";
import { FaExternalLinkAlt, FaHeart, FaRegHeart, FaShare } from "react-icons/fa";
import { Button, buttonVariants } from "@/components/ui/button";
import PoetImage from "@/components/PoetImage";
import { cn } from "@/lib/utils";
import type { Poem } from "@/types/poem";

interface PoemActionButtonsProps {
  poem: Poem;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  isPoetPage: boolean;
  /** On a poet page the profile button opens the poet's info instead of linking to the page. */
  onTogglePoetInfo?: () => void;
  onShare: () => void;
}

// Custom poems carry their own URL; Ganjoor ones are site paths.
const sourceUrl = (poem: Poem) =>
  poem.isCustom ? poem.fullUrl : `https://ganjoor.net${poem.fullUrl}`;

/** Favorite, share, source and the poet's profile, beside the poem. */
export default function PoemActionButtons({
  poem,
  isFavorite,
  onToggleFavorite,
  isPoetPage,
  onTogglePoetInfo,
  onShare,
}: PoemActionButtonsProps) {
  const opensPoetInfo = isPoetPage && Boolean(onTogglePoetInfo);
  const keepPoetProfileVisible = opensPoetInfo && Boolean(poem.poet && poem.poetSlug);

  const poetPortrait = (
    <>
      <div className="poet-image-container">
        <PoetImage
          imgUrl={poem.poetImageUrl}
          alt={poem.poet}
          width={60}
          height={60}
        />
      </div>
      <h3 className="poet-profile-name">{poem.poet}</h3>
    </>
  );

  return (
    <div
      className={`action-buttons${keepPoetProfileVisible ? " action-buttons--profile-persistent" : ""}`}
    >
      <Button
        type="button"
        variant={isFavorite ? "default" : "outline"}
        size="icon"
        className={`action-button poem-favorite-button rounded-full shadow-sm${isFavorite ? " is-active" : ""}`}
        onClick={onToggleFavorite}
        title={isFavorite ? "حذف از ذخیره‌ها" : "ذخیره شعر"}
        aria-pressed={isFavorite}
        aria-label={isFavorite ? "حذف از ذخیره‌ها" : "ذخیره شعر"}
      >
        {isFavorite ? <FaHeart /> : <FaRegHeart />}
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="action-button poem-share-button rounded-full shadow-sm"
        onClick={onShare}
        title="اشتراک‌گذاری"
      >
        <FaShare />
      </Button>
      <a
        href={sourceUrl(poem)}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(buttonVariants({ variant: "outline", size: "icon" }), "action-button poem-source-button rounded-full shadow-sm")}
        title="مشاهده منبع"
        aria-label="مشاهده منبع"
      >
        <FaExternalLinkAlt />
      </a>
      {poem.poet &&
        poem.poetSlug &&
        (opensPoetInfo ? (
          <button
            type="button"
            onClick={onTogglePoetInfo}
            className="poet-profile"
            aria-label={`نمایش اطلاعات ${poem.poet}`}
            title={`نمایش اطلاعات ${poem.poet}`}
          >
            {poetPortrait}
          </button>
        ) : (
          <Link
            href={`/${poem.poetSlug}`}
            className="poet-profile"
            prefetch
            aria-label={`مشاهده اشعار ${poem.poet}`}
            title={`مشاهده اشعار ${poem.poet}`}
          >
            {poetPortrait}
          </Link>
        ))}
    </div>
  );
}
