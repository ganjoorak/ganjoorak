"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  FaArrowRight,
  FaHeart,
  FaRegHeart,
  FaStar,
  FaChevronLeft,
  FaLink,
  FaRandom,
  FaShareAlt,
  FaSpinner,
  FaRegStar,
} from "react-icons/fa";
import PoetImage from "@/components/PoetImage";
import { Button } from "@/components/ui/button";
import { usePreferredPoet } from "@/hooks/usePreferredPoet";
import type { Poet } from "@/types/poet";
import "../styles/PoetProfile.css";

const numberFormatter = new Intl.NumberFormat("fa-IR", { useGrouping: false });
const groupedFormatter = new Intl.NumberFormat("fa-IR");

export const formatPersianCount = (value: number) =>
  groupedFormatter.format(value);

const CENTURY_ORDINALS = [
  "",
  "یکم",
  "دوم",
  "سوم",
  "چهارم",
  "پنجم",
  "ششم",
  "هفتم",
  "هشتم",
  "نهم",
  "دهم",
  "یازدهم",
  "دوازدهم",
  "سیزدهم",
  "چهاردهم",
  "پانزدهم",
];

const describeLifetime = (poet: Poet) => {
  const birth = Math.max(0, poet.birthYearInLHijri ?? 0);
  const death = Math.max(0, poet.deathYearInLHijri ?? 0);
  let years = "";
  if (birth && death) {
    years = `${numberFormatter.format(birth)} تا ${numberFormatter.format(death)} ق`;
  } else if (death) {
    years = `درگذشت ${numberFormatter.format(death)} ق`;
  } else if (birth) {
    years = `زادهٔ ${numberFormatter.format(birth)} ق`;
  }
  const reference = death || birth;
  const centuryIndex = reference ? Math.ceil(reference / 100) : 0;
  const century = CENTURY_ORDINALS[centuryIndex] || "";
  return { years, century };
};

export interface PoetProfileStat {
  label: string;
  value: string;
}

interface PoetProfileProps {
  poet: Poet;
  isOpen: boolean;
  poetKey: string;
  stats: PoetProfileStat[];
  /** Present once a poem is on screen: lets the reader jump back to it. */
  onResume?: () => void;
  onRandom: () => void;
  isRandomLoading?: boolean;
  children?: ReactNode;
}

export default function PoetProfile({
  poet,
  isOpen,
  poetKey,
  stats,
  onResume,
  onRandom,
  isRandomLoading = false,
  children,
}: PoetProfileProps) {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isScrolled, setIsScrolled] = useState(false);
  const [isBioExpanded, setIsBioExpanded] = useState(false);
  const [shareState, setShareState] = useState<"idle" | "copied">("idle");
  const { isPreferred, togglePreferred } = usePreferredPoet(poetKey);

  const displayName = poet.nickname || poet.name;
  const { years, century } = describeLifetime(poet);
  const bio = (poet.description || "").trim();
  const isBioLong = bio.length > 220;
  const allStats = century ? [...stats, { label: "قرن", value: century }] : stats;
  const metaItems = [years, poet.birthPlace || poet.deathPlace || ""]
    .map((value) => value.trim())
    .filter(Boolean);

  useEffect(() => {
    if (!isOpen) return;
    const node = scrollRef.current;
    if (!node) return;
    const onScroll = () => setIsScrolled(node.scrollTop > 140);
    onScroll();
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, [isOpen]);

  useEffect(() => {
    if (shareState !== "copied") return;
    const timer = window.setTimeout(() => setShareState("idle"), 1800);
    return () => window.clearTimeout(timer);
  }, [shareState]);

  const handleBack = () => {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push("/poets");
    }
  };

  const handleShare = async () => {
    const url = window.location.href.split("?")[0];
    try {
      if (navigator.share) {
        await navigator.share({ title: displayName, url });
        return;
      }
      await navigator.clipboard?.writeText(url);
      setShareState("copied");
    } catch {
      // The share sheet was dismissed; nothing to do.
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="poet-profile"
          ref={scrollRef}
          className="poet-profile-page"
          dir="rtl"
          role="region"
          aria-label={`صفحهٔ ${displayName}`}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          <header
            className={`poet-profile-bar${isScrolled ? " is-scrolled" : ""}`}
          >
            {/* With a poem underneath, the only way back is to that poem; the arrow (leave the page) is for
                a profile that is the page itself. */}
            {onResume ? (
              <Button
                variant="secondary"
                size="sm"
                className="poet-profile-resume"
                onClick={onResume}
              >
                ادامهٔ خواندن
                <FaChevronLeft />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon-lg"
                className="poet-profile-bar-icon"
                onClick={handleBack}
                aria-label="بازگشت"
              >
                <FaArrowRight />
              </Button>
            )}
            <span className="poet-profile-bar-title" aria-hidden={!isScrolled}>
              {displayName}
            </span>
            <div className="poet-profile-bar-actions">
              <Button
                variant="ghost"
                size="icon-lg"
                className="poet-profile-bar-icon"
                onClick={handleShare}
                aria-label={shareState === "copied" ? "پیوند کپی شد" : "اشتراک‌گذاری"}
              >
                {shareState === "copied" ? <FaLink /> : <FaShareAlt />}
              </Button>
            </div>
          </header>

          <div className="poet-profile-layout">
            <aside className="poet-profile-card">
              <div className="poet-profile-identity">
                <div className="poet-profile-avatar">
                  <PoetImage
                    imgUrl={poet.imageUrl}
                    alt={displayName}
                    poetSlug={poet.urlSlug}
                    width={112}
                    height={112}
                  />
                </div>
                <div className="poet-profile-names">
                  <h1>{displayName}</h1>
                  {poet.nickname && poet.nickname !== poet.name && (
                    <p className="poet-profile-fullname">{poet.name}</p>
                  )}
                  {metaItems.length > 0 && (
                    <p className="poet-profile-meta">
                      {metaItems.map((item, index) => (
                        <span key={item}>
                          {index > 0 && (
                            <span className="poet-profile-dot" aria-hidden="true">
                              ·
                            </span>
                          )}
                          {item}
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              </div>

              {allStats.length > 0 && (
                <dl className="poet-profile-stats">
                  {allStats.map((stat) => (
                    <div key={stat.label}>
                      <dt>{stat.label}</dt>
                      <dd>{stat.value}</dd>
                    </div>
                  ))}
                </dl>
              )}

              <div className="poet-profile-actions">
                <Button
                  variant={isPreferred ? "secondary" : "default"}
                  className="poet-profile-prefer"
                  aria-pressed={isPreferred}
                  onClick={togglePreferred}
                >
                  {isPreferred ? <FaStar /> : <FaRegStar />}
                  {isPreferred ? "مورد علاقه" : "علاقه‌مندم"}
                </Button>
                <div className="poet-profile-quick">
                  <Button
                    variant="outline"
                    className="poet-profile-quick-button"
                    onClick={onRandom}
                    disabled={isRandomLoading}
                  >
                    {isRandomLoading ? (
                      <FaSpinner className="animate-spin" />
                    ) : (
                      <FaRandom />
                    )}
                    شعر تصادفی
                  </Button>
                </div>
              </div>

              {bio && (
                <div className="poet-profile-bio">
                  <p className={isBioLong && !isBioExpanded ? "is-clamped" : ""}>
                    {bio}
                  </p>
                  {isBioLong && (
                    <button
                      type="button"
                      className="poet-profile-bio-toggle"
                      onClick={() => setIsBioExpanded((value) => !value)}
                      aria-expanded={isBioExpanded}
                    >
                      {isBioExpanded ? "کمتر" : "بیشتر"}
                    </button>
                  )}
                </div>
              )}
            </aside>

            <div className="poet-profile-main">{children}</div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function PoetProfileSection({
  title,
  hint,
  aside,
  children,
}: {
  title: string;
  hint?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="poet-profile-section">
      <div className="poet-profile-section-head">
        <h2>{title}</h2>
        {aside}
      </div>
      {hint && <p className="poet-profile-section-hint">{hint}</p>}
      {children}
    </section>
  );
}

export interface PoetProfileRow {
  id: number;
  title: string;
  subtitle?: string;
  badge?: string;
  count?: number;
  isSelected?: boolean;
  isLoading?: boolean;
  /** Whether the reader loves this book; the heart shows on top-level rows that set it. */
  isLoved?: boolean;
  children?: PoetProfileRow[];
}

export function PoetProfileList({
  rows,
  onSelect,
  onToggleLove,
  depth = 0,
}: {
  rows: PoetProfileRow[];
  onSelect: (id: number) => void;
  /** Adds a heart to each top-level row (a book the reader can love). */
  onToggleLove?: (id: number) => void;
  depth?: number;
}) {
  if (rows.length === 0) return null;
  return (
    <ul className={depth === 0 ? "poet-profile-list" : "poet-profile-sublist"}>
      {rows.map((row) => (
        <li key={row.id}>
          <div className="poet-profile-line">
          <button
            type="button"
            className={`poet-profile-row${row.isSelected ? " is-selected" : ""}`}
            onClick={() => onSelect(row.id)}
            aria-current={row.isSelected ? "true" : undefined}
          >
            {row.badge !== undefined && (
              <span className="poet-profile-row-badge">{row.badge}</span>
            )}
            <span className="poet-profile-row-text">
              <span className="poet-profile-row-title">{row.title}</span>
              {row.subtitle && (
                <span className="poet-profile-row-subtitle">{row.subtitle}</span>
              )}
            </span>
            {row.isLoading ? (
              <FaSpinner
                className="poet-profile-row-trail animate-spin"
                aria-label="در حال بارگذاری"
              />
            ) : (
              <span className="poet-profile-row-trail">
                {row.count ? (
                  <span className="poet-profile-row-count">
                    {formatPersianCount(row.count)} شعر
                  </span>
                ) : null}
                <FaChevronLeft aria-hidden="true" />
              </span>
            )}
          </button>
          {depth === 0 && onToggleLove && row.isLoved !== undefined && (
            <button
              type="button"
              className={`poet-profile-love${row.isLoved ? " is-loved" : ""}`}
              aria-pressed={row.isLoved === true}
              aria-label={
                row.isLoved
                  ? `برداشتن «${row.title}» از دوست‌داشته‌ها`
                  : `دوست داشتن «${row.title}»`
              }
              onClick={() => onToggleLove(row.id)}
            >
              {row.isLoved ? <FaHeart aria-hidden="true" /> : <FaRegHeart aria-hidden="true" />}
            </button>
          )}
          </div>
          {row.children && row.children.length > 0 && (
            <PoetProfileList
              rows={row.children}
              onSelect={onSelect}
              depth={depth + 1}
            />
          )}
        </li>
      ))}
    </ul>
  );
}
