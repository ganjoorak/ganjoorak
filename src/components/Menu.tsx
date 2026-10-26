"use client";

import { Button } from "@/components/ui/button";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  FaBars,
  FaBell,
  FaBookmark,
  FaChevronLeft,
  FaChevronRight,
  FaCommentDots,
  FaCompass,
  FaEllipsisH,
  FaHome,
  FaMinus,
  FaMoon,
  FaPlus,
  FaQuestionCircle,
  FaRegNewspaper,
  FaSearch,
  FaSlidersH,
  FaSun,
  FaTimes,
  FaUserCheck,
  FaUserCircle,
  FaUsers,
} from "react-icons/fa";
import {
  POEM_FONT_SIZE_MAX,
  POEM_FONT_SIZE_MIN,
  POEM_FONT_SIZE_STEP,
  useSettings,
  type ThemeOption,
} from "@/context/SettingsContext";
import FeedbackForm from "@/components/FeedbackForm";

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
  /**
   * Poem-specific actions shown as the first menu section on phones only
   * (the mobile bottom bar keeps just like, play and menu).
   */
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
  badge?: string;
  count?: string;
  onClick?: () => void;
};

type MenuButtonItem = {
  kind: "button";
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  ariaPressed?: boolean;
};

type MenuItem = MenuLinkItem | MenuButtonItem;

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

const isRouteActive = (pathname: string | null, href: string) => {
  if (!pathname || href.includes("?")) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
};

const Menu: React.FC<MenuProps> = ({
  isOpen,
  onClose,
  hasNewUpdates = false,
  onUpdatesViewed,
  onOpenSettings,
}) => {
  const router = useRouter();
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
  const { settings, setTheme, setPoemFontSize } = useSettings();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const lastPathnameRef = useRef(pathname);
  const [view, setView] = useState<"main" | "more" | "feedback">("main");

  const followedCount = settings.followedPoetKeys?.length ?? 0;

  const discoverItems = useMemo<MenuLinkItem[]>(
    () => [
      { kind: "link", href: "/", icon: <FaHome />, label: "صفحه اصلی" },
      { kind: "link", href: "/explore", icon: <FaCompass />, label: "کاوش" },
      { kind: "link", href: "/poets", icon: <FaUsers />, label: "شاعران" },
    ],
    [],
  );

  const libraryItems = useMemo<MenuItem[]>(
    () => [
      { kind: "link", href: "/saved", icon: <FaBookmark />, label: "نشان‌شده‌ها" },
      {
        kind: "link",
        href: "/following",
        icon: <FaUserCheck />,
        label: "شاعران دنبال‌شده",
        count: followedCount > 0 ? persianNumber.format(followedCount) : undefined,
      },
      { kind: "link", href: "/profile", icon: <FaUserCircle />, label: "حساب کاربری" },
    ],
    [followedCount],
  );

  const moreItems = useMemo<MenuItem[]>(
    () => [
      {
        kind: "link",
        href: "/updates",
        icon: <FaBell />,
        label: "بروزرسانی‌ها",
        badge: hasNewUpdates ? "جدید" : undefined,
        onClick: () => onUpdatesViewed?.(),
      },
      {
        kind: "link",
        href: "/faq",
        icon: <FaQuestionCircle />,
        label: "پرسش‌های متداول",
      },
      {
        kind: "button",
        icon: <FaCommentDots />,
        label: "بازخورد",
        onClick: () => setView("feedback"),
      },
    ],
    [hasNewUpdates, onUpdatesViewed],
  );

  useEffect(() => {
    if (!isOpen) setView("main");
  }, [isOpen]);

  useEffect(() => {
    [...discoverItems, ...libraryItems, ...moreItems].forEach((item) => {
      if (item.kind === "link") {
        router.prefetch(item.href);
      }
    });
  }, [discoverItems, libraryItems, moreItems, router]);

  // Close when the route changes underneath the drawer (back/forward, in-page navigation).
  useEffect(() => {
    if (lastPathnameRef.current === pathname) return;
    lastPathnameRef.current = pathname;
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

  const renderItem = (item: MenuItem) => {
    if (item.kind === "button") {
      return (
        <li key={item.label}>
          <button
            type="button"
            className="menu-link"
            onClick={item.onClick}
            aria-pressed={item.ariaPressed}
          >
            <span className="menu-link-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span className="menu-link-label">{item.label}</span>
          </button>
        </li>
      );
    }

    const active = isRouteActive(pathname, item.href);

    return (
      <li key={item.href}>
        <Link
          href={item.href}
          prefetch
          className={`menu-link${active ? " is-active" : ""}`}
          aria-current={active ? "page" : undefined}
          onClick={() => {
            item.onClick?.();
            onClose();
          }}
        >
          <span className="menu-link-icon" aria-hidden="true">
            {item.icon}
          </span>
          <span className="menu-link-label">{item.label}</span>
          {item.count && <span className="menu-link-count">{item.count}</span>}
          {item.badge && <span className="menu-link-badge">{item.badge}</span>}
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
    : {
        initial: { x: "100%" },
        animate: { x: 0 },
        exit: { x: "100%" },
        transition: { duration: 0.3, ease: [0.32, 0.72, 0, 1] as const },
      };

  const canDecreaseFont = settings.poemFontSize > POEM_FONT_SIZE_MIN;
  const canIncreaseFont = settings.poemFontSize < POEM_FONT_SIZE_MAX;

  return (
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
            className="menu-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="menu-drawer-title"
            id="main-menu"
            {...drawerMotion}
          >
            <header className="menu-drawer-header">
              <div className="menu-brand">
                <Image
                  src="/icon-192.png"
                  alt=""
                  width={40}
                  height={40}
                  className="menu-brand-logo"
                  priority
                />
                <div className="menu-brand-text">
                  <span id="menu-drawer-title" className="menu-brand-title">
                    گنجورک
                  </span>
                  <span className="menu-brand-subtitle">
                    راحت‌تر شعر بخوانیم و شعر گوش دهیم
                  </span>
                </div>
              </div>
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
              <AnimatePresence mode="wait" initial={false}>
                {view === "main" ? (
                  <motion.div
                    key="menu-view-main"
                    className="menu-view"
                    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 24 }}
                    transition={{ duration: 0.18 }}
                  >
                    <section className="menu-section" aria-labelledby="menu-section-discover">
                      <h2 id="menu-section-discover" className="menu-section-title">
                        کشف شعر
                      </h2>
                      <ul className="menu-list">
                        {discoverItems.map((item) => renderItem(item))}
                      </ul>
                    </section>

                    <section className="menu-section" aria-labelledby="menu-section-library">
                      <h2 id="menu-section-library" className="menu-section-title">
                        کتابخانهٔ من
                      </h2>
                      <ul className="menu-list">
                        {libraryItems.map((item) => renderItem(item))}
                      </ul>
                    </section>

                    <section className="menu-section" aria-label="بیشتر">
                      <ul className="menu-list">
                        <li>
                          <button
                            type="button"
                            className="menu-link menu-link--more"
                            onClick={() => setView("more")}
                            aria-haspopup="true"
                          >
                            <span className="menu-link-icon" aria-hidden="true">
                              <FaEllipsisH />
                            </span>
                            <span className="menu-link-label">بیشتر</span>
                            {hasNewUpdates && (
                              <span className="menu-link-dot" aria-label="بروزرسانی جدید" />
                            )}
                            <span className="menu-settings-chevron" aria-hidden="true">
                              <FaChevronLeft />
                            </span>
                          </button>
                        </li>
                      </ul>
                    </section>
                  </motion.div>
                ) : view === "more" ? (
                  <motion.div
                    key="menu-view-more"
                    className="menu-view"
                    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -24 }}
                    transition={{ duration: 0.18 }}
                  >
                    <div className="menu-subpage-header">
                      <button
                        type="button"
                        className="menu-subpage-back"
                        onClick={() => setView("main")}
                        aria-label="بازگشت به منو"
                      >
                        <FaChevronRight aria-hidden="true" />
                      </button>
                      <h2 className="menu-subpage-title">بیشتر</h2>
                    </div>
                    <section className="menu-section">
                      <ul className="menu-list">
                        {moreItems.map((item) => renderItem(item))}
                      </ul>
                    </section>
                  </motion.div>
                ) : (
                  <motion.div
                    key="menu-view-feedback"
                    className="menu-view"
                    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -24 }}
                    transition={{ duration: 0.18 }}
                  >
                    <div className="menu-subpage-header">
                      <button
                        type="button"
                        className="menu-subpage-back"
                        onClick={() => setView("more")}
                        aria-label="بازگشت به بیشتر"
                      >
                        <FaChevronRight aria-hidden="true" />
                      </button>
                      <h2 className="menu-subpage-title">بازخورد</h2>
                    </div>
                    <FeedbackForm onDone={onClose} />
                  </motion.div>
                )}
              </AnimatePresence>
            </nav>

            {/* The feedback form needs the room, especially with a phone keyboard up. */}
            {view !== "feedback" && (
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
                        className={`menu-theme-option${active ? " is-active" : ""}`}
                        onClick={() => setTheme(option.value)}
                      >
                        <span className="menu-theme-option-icon">{option.icon}</span>
                        <span>{option.label}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="menu-footer-row">
                  <button
                    type="button"
                    className="menu-settings-button"
                    onClick={() => {
                      onOpenSettings();
                      onClose();
                    }}
                  >
                    <span className="menu-link-icon" aria-hidden="true">
                      <FaSlidersH />
                    </span>
                    <span className="menu-link-label">تنظیمات</span>
                    <span className="menu-settings-chevron" aria-hidden="true">
                      <FaChevronLeft />
                    </span>
                  </button>

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
                </div>
              </footer>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
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
      aria-label="منو"
      aria-haspopup="dialog"
      aria-controls="main-menu"
      aria-expanded={isOpen}
    >
      <FaBars size={16} aria-hidden="true" />
      {hasNotification && (
        <span className="menu-button-indicator" aria-hidden="true" />
      )}
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
