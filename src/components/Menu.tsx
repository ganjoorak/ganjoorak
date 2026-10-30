"use client";

import { Button } from "@/components/ui/button";
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion, useDragControls, useReducedMotion } from "framer-motion";
import {
  FaBars,
  FaBookmark,
  FaCompass,
  FaFeatherAlt,
  FaHome,
  FaMinus,
  FaMoon,
  FaRegNewspaper,
  FaPlus,
  FaRegStar,
  FaSearch,
  FaSun,
  FaTimes,
  FaUserCheck,
  FaUsers,
} from "react-icons/fa";
import {
  POEM_FONT_SIZE_MAX,
  POEM_FONT_SIZE_MIN,
  POEM_FONT_SIZE_STEP,
  useSettings,
  type ThemeOption,
} from "@/context/SettingsContext";
import ProfileAvatar from "@/components/ProfileAvatar";
import StoriesRow from "@/components/stories/StoriesRow";
import StoryViewer from "@/components/stories/StoryViewer";
import { useAccountSession } from "@/hooks/useAccountSession";
import { markStorySeen, useFollowingStories } from "@/hooks/useFollowingStories";
import type { StoryPerson } from "@/utils/quotesApi";

interface MenuProps {
  isOpen: boolean;
  onClose: () => void;
  hasNewUpdates?: boolean;
  onUpdatesViewed?: () => void;
  onOpenSettings: () => void;
  onOpenFeed?: () => void;
  onOpenFeedLabel?: string;
  onOpenSearch?: () => void;
  isZenLocked?: boolean;
  onToggleZenLock?: () => void;
  /** Accepted for the hosts that pass it; the menu itself no longer shows poem actions. */
  poemActions?: MenuPoemActions;
}

export interface MenuPoemActions {
  poetName?: string;
  poetImageUrl?: string;
  poetHref?: string;
  onPoetClick?: () => void;
  onShare: () => void;
  onOpenSearch: () => void;
  isZenLocked?: boolean;
  onToggleZenLock?: () => void;
}

type MenuLinkItem = {
  kind: "link";
  href: string;
  icon: React.ReactNode;
  label: string;
  count?: string;
};

const THEME_OPTIONS: Array<{
  value: ThemeOption;
  label: string;
  icon: React.ReactNode;
}> = [
  { value: "dark", label: "تاریک", icon: <FaMoon aria-hidden="true" /> },
  { value: "light", label: "روشن", icon: <FaSun aria-hidden="true" /> },
  { value: "paper", label: "کاغذی", icon: <FaRegNewspaper aria-hidden="true" /> },
];

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const persianNumber = new Intl.NumberFormat("fa-IR");

// Phones and small tablets get a bottom sheet instead of the side drawer: the breakpoint the floating
// controls (mobile-floating-controls.css) already switch layout at.
const SHEET_QUERY = "(max-width: 768px)";
const subscribeSheet = (callback: () => void) => {
  const query = window.matchMedia(SHEET_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
};
const useIsSheet = () =>
  useSyncExternalStore(
    subscribeSheet,
    () => window.matchMedia(SHEET_QUERY).matches,
    () => false,
  );

/** Past this drag distance (px) or fling speed (px/s) a sheet drag dismisses the menu. */
const SHEET_DISMISS_DISTANCE = 90;
const SHEET_DISMISS_VELOCITY = 500;

const isRouteActive = (pathname: string | null, href: string) => {
  if (!pathname || href.includes("?")) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
};

const Menu: React.FC<MenuProps> = ({
  isOpen,
  onClose,
  onOpenSettings,
}) => {
  const router = useRouter();
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
  const isSheet = useIsSheet();
  const dragControls = useDragControls();
  const { settings, setTheme, setPoemFontSize } = useSettings();
  const { user } = useAccountSession();
  const stories = useFollowingStories();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const lastPathnameRef = useRef(pathname);
  // Frozen when opened: the viewer indexes into this list while the live one re-sorts as stories are seen.
  const [viewer, setViewer] = useState<{ people: StoryPerson[]; startIndex: number } | null>(null);
  const isViewerOpenRef = useRef(false);
  isViewerOpenRef.current = viewer !== null;

  const preferredCount = settings.preferredPoetKeys?.length ?? 0;

  const discoverItems = useMemo<MenuLinkItem[]>(
    () => [
      { kind: "link", href: "/", icon: <FaHome />, label: "صفحه اصلی" },
      { kind: "link", href: "/explore", icon: <FaCompass />, label: "کاوش" },
      { kind: "link", href: "/poets", icon: <FaUsers />, label: "شاعران" },
      { kind: "link", href: "/moshaere", icon: <FaFeatherAlt />, label: "مشاعره" },
    ],
    [],
  );

  const libraryItems = useMemo<MenuLinkItem[]>(
    () => [
      { kind: "link", href: "/saved", icon: <FaBookmark />, label: "نشان‌شده‌ها" },
      {
        kind: "link",
        href: "/preferred-poets",
        icon: <FaRegStar />,
        label: "شاعران مورد علاقه",
        count: preferredCount > 0 ? persianNumber.format(preferredCount) : undefined,
      },
      { kind: "link", href: "/following", icon: <FaUserCheck />, label: "دنبال‌شده‌ها" },
    ],
    [preferredCount],
  );

  const { refresh: refreshStories } = stories;
  useEffect(() => {
    if (isOpen) refreshStories();
    // refresh only reads the shared store; it is recreated each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) setViewer(null);
  }, [isOpen]);

  useEffect(() => {
    [...discoverItems, ...libraryItems].forEach((item) => router.prefetch(item.href));
    router.prefetch("/profile");
    router.prefetch("/login");
  }, [discoverItems, libraryItems, router]);

  // Close when the route changes underneath the drawer (back/forward, in-page navigation).
  useEffect(() => {
    if (lastPathnameRef.current === pathname) return;
    lastPathnameRef.current = pathname;
    setViewer(null);
    if (isOpen) onClose();
  }, [isOpen, onClose, pathname]);

  // Scroll lock, Escape, focus trap and focus restoration while open.
  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";

    const focusFrame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus({ preventScroll: true });
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      // The story viewer sits on top and handles its own keys.
      if (isViewerOpenRef.current) return;

      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;

      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const isInside = active instanceof Node && panel.contains(active);

      if (event.shiftKey) {
        if (!isInside || active === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (!isInside || active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [isOpen, onClose]);

  const handleFontSizeStep = useCallback(
    (direction: 1 | -1) => {
      setPoemFontSize(settings.poemFontSize + direction * POEM_FONT_SIZE_STEP);
    },
    [setPoemFontSize, settings.poemFontSize],
  );

  const renderItem = (item: MenuLinkItem) => {
    const active = isRouteActive(pathname, item.href);

    return (
      <li key={item.href}>
        <Link
          href={item.href}
          prefetch
          className={`menu-link${active ? " is-active" : ""}`}
          aria-current={active ? "page" : undefined}
          onClick={onClose}
        >
          <span className="menu-link-icon" aria-hidden="true">
            {item.icon}
          </span>
          <span className="menu-link-label">{item.label}</span>
          {item.count && <span className="menu-link-count">{item.count}</span>}
        </Link>
      </li>
    );
  };

  const drawerMotion = reduceMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.15 },
      }
    : isSheet
      ? {
          initial: { y: "100%" },
          animate: { y: 0 },
          exit: { y: "100%" },
          transition: { duration: 0.3, ease: [0.32, 0.72, 0, 1] as const },
        }
      : {
          initial: { x: "100%" },
          animate: { x: 0 },
          exit: { x: "100%" },
          transition: { duration: 0.3, ease: [0.32, 0.72, 0, 1] as const },
        };

  const canDecreaseFont = settings.poemFontSize > POEM_FONT_SIZE_MIN;
  const canIncreaseFont = settings.poemFontSize < POEM_FONT_SIZE_MAX;

  return (
    <>
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            key="menu-backdrop"
            className="menu-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0.15 : 0.22 }}
            onClick={onClose}
            aria-hidden="true"
          />

          <motion.div
            key="menu-drawer"
            ref={panelRef}
            className={`menu-drawer${isSheet ? " menu-drawer--sheet" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="menu-drawer-title"
            id="main-menu"
            {...drawerMotion}
            // Sheet: the grabber starts a vertical drag; a far or fast pull down closes, otherwise it springs back.
            drag={isSheet ? "y" : false}
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            dragSnapToOrigin
            onDragEnd={(_, info) => {
              if (info.offset.y > SHEET_DISMISS_DISTANCE || info.velocity.y > SHEET_DISMISS_VELOCITY) onClose();
            }}
          >
            {isSheet && (
              <div
                className="menu-sheet-grabber"
                aria-hidden="true"
                onPointerDown={(event) => dragControls.start(event)}
              >
                <span className="menu-sheet-grabber-bar" />
              </div>
            )}
            <header className="menu-drawer-header">
              {user ? (
                <Link href="/profile" prefetch className="menu-account" onClick={onClose}>
                  <ProfileAvatar
                    username={user.username}
                    avatar={user.avatar}
                    className="menu-account-avatar"
                    decorative
                  />
                  <span className="menu-account-text">
                    <span id="menu-drawer-title" className="menu-account-name">
                      {user.displayName}
                    </span>
                    <span className="menu-account-meta" dir="ltr">
                      @{user.username}
                    </span>
                  </span>
                </Link>
              ) : (
                <Link href="/login" prefetch className="menu-account" onClick={onClose}>
                  <Image
                    src="/icon-192.png"
                    alt=""
                    width={44}
                    height={44}
                    className="menu-account-logo"
                    priority
                  />
                  <span className="menu-account-text">
                    <span id="menu-drawer-title" className="menu-account-name">
                      گنجورک
                    </span>
                    <span className="menu-account-meta menu-account-meta--action">
                      ورود یا ساخت حساب
                    </span>
                  </span>
                </Link>
              )}
              <button
                ref={closeButtonRef}
                type="button"
                className="menu-close"
                onClick={onClose}
                aria-label="بستن منو"
              >
                <FaTimes aria-hidden="true" />
              </button>
            </header>

            <nav className="menu-drawer-body" aria-label="منوی اصلی">
              <StoriesRow
                people={stories.people}
                isUnseen={stories.isUnseen}
                onOpen={(index) => setViewer({ people: stories.people, startIndex: index })}
              />

              <section className="menu-section" aria-labelledby="menu-section-discover">
                <h2 id="menu-section-discover" className="menu-section-title">
                  گنجورک
                </h2>
                <ul className="menu-list">{discoverItems.map((item) => renderItem(item))}</ul>
              </section>

              <section className="menu-section" aria-labelledby="menu-section-library">
                <h2 id="menu-section-library" className="menu-section-title">
                  کتابخانهٔ من
                </h2>
                <ul className="menu-list">{libraryItems.map((item) => renderItem(item))}</ul>
              </section>

              <section className="menu-section menu-section--quiet" aria-label="تنظیمات">
                <ul className="menu-list">
                  <li>
                    <button
                      type="button"
                      className="menu-link"
                      onClick={() => {
                        onOpenSettings();
                        onClose();
                      }}
                    >
                      <span className="menu-link-label">تنظیمات</span>
                    </button>
                  </li>
                </ul>
              </section>
            </nav>

            <footer className="menu-drawer-footer">
              <div
                className="menu-theme-switch"
                role="radiogroup"
                aria-label="پوستهٔ نمایش"
              >
                {THEME_OPTIONS.map((option) => {
                  const active = settings.theme === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      aria-label={option.label}
                      title={option.label}
                      className={`menu-theme-option${active ? " is-active" : ""}`}
                      onClick={() => setTheme(option.value)}
                    >
                      {option.icon}
                    </button>
                  );
                })}
              </div>

              <div
                className="menu-font-stepper"
                role="group"
                aria-label="اندازهٔ متن شعر"
              >
                <button
                  type="button"
                  onClick={() => handleFontSizeStep(-1)}
                  disabled={!canDecreaseFont}
                  aria-label="کوچک‌تر کردن متن"
                >
                  <FaMinus aria-hidden="true" />
                </button>
                <span className="menu-font-stepper-value" aria-live="polite">
                  {persianNumber.format(settings.poemFontSize)}٪
                </span>
                <button
                  type="button"
                  onClick={() => handleFontSizeStep(1)}
                  disabled={!canIncreaseFont}
                  aria-label="بزرگ‌تر کردن متن"
                >
                  <FaPlus aria-hidden="true" />
                </button>
              </div>
            </footer>
          </motion.div>
        </>
      )}
    </AnimatePresence>
    {viewer && (
      <StoryViewer
        people={viewer.people}
        startIndex={viewer.startIndex}
        onSeen={markStorySeen}
        onClose={() => setViewer(null)}
      />
    )}
    </>
  );
};

export function MenuButton({
  onClick,
  hasNotification = false,
  isHidden = false,
  isOpen,
}: {
  onClick: () => void;
  hasNotification?: boolean;
  isHidden?: boolean;
  isOpen?: boolean;
}) {
  // A dot for whatever is new inside: a recent update, or a followed person's unseen poem lines.
  const { hasUnseen } = useFollowingStories();
  const showDot = hasNotification || hasUnseen;

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={onClick}
      className={[
        "menu-button fixed top-4 right-4 rounded-full shadow-sm",
        isHidden ? "is-hidden" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={showDot ? "منو، مورد تازه دارد" : "منو"}
      aria-haspopup="dialog"
      aria-controls="main-menu"
      aria-expanded={isOpen}
    >
      <FaBars size={16} aria-hidden="true" />
      {showDot && <span className="menu-button-indicator" aria-hidden="true" />}
    </Button>
  );
}

export function SearchButton({
  onClick,
  isHidden = false,
}: {
  onClick: () => void;
  isHidden?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={onClick}
      className={[
        "global-search-button fixed top-16 right-4 rounded-full shadow-sm",
        isHidden ? "is-hidden" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label="جست‌وجو"
    >
      <FaSearch size={15} aria-hidden="true" />
    </Button>
  );
}

export default Menu;
