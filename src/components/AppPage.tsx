"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FaArrowRight, FaBars, FaSearch } from "react-icons/fa";
import Menu from "@/components/Menu";
import SettingsDialog from "@/components/SettingsDialog";
import GlobalSearchDialog from "@/components/GlobalSearchDialog";
import { Button } from "@/components/ui/button";
import { useUpdateNotification } from "@/hooks/useUpdateNotification";
import "../styles/AppPage.css";

interface AppPageProps {
  title: string;
  subtitle?: ReactNode;
  /** Extra controls rendered under the large title (search field, tabs...). */
  headerExtra?: ReactNode;
  /** Buttons placed in the top bar before the search/menu icons. */
  actions?: ReactNode;
  /** Where «بازگشت» goes when there is no history to pop. */
  backHref?: string;
  hideSearch?: boolean;
  width?: "narrow" | "default" | "wide";
  className?: string;
  children: ReactNode;
}

/**
 * Shared app-style page: a sticky top bar (back, title that fades in on scroll,
 * search and menu) over a large title header and mobile-first content.
 */
export default function AppPage({
  title,
  subtitle,
  headerExtra,
  actions,
  backHref = "/",
  hideSearch = false,
  width = "default",
  className,
  children,
}: AppPageProps) {
  const router = useRouter();
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const { hasNewUpdates, markAsRead } = useUpdateNotification();

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 56);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleBack = () => {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push(backHref);
    }
  };

  return (
    <div className={["app-page", className].filter(Boolean).join(" ")} dir="rtl">
      <header className={`app-page-bar${isScrolled ? " is-scrolled" : ""}`}>
        <Button
          variant="ghost"
          size="icon-lg"
          className="app-page-bar-icon"
          onClick={handleBack}
          aria-label="بازگشت"
        >
          <FaArrowRight />
        </Button>
        <span className="app-page-bar-title" aria-hidden={!isScrolled}>
          {title}
        </span>
        <div className="app-page-bar-actions">
          {actions}
          {!hideSearch && (
            <Button
              variant="ghost"
              size="icon-lg"
              className="app-page-bar-icon"
              onClick={() => setIsSearchOpen(true)}
              aria-label="جست‌وجو"
            >
              <FaSearch />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-lg"
            className="app-page-bar-icon app-page-menu"
            onClick={() => setIsMenuOpen(true)}
            aria-label="منو"
            aria-haspopup="dialog"
            aria-controls="main-menu"
          >
            <FaBars />
            {hasNewUpdates && <span className="menu-button-indicator" aria-hidden="true" />}
          </Button>
        </div>
      </header>

      <Menu
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        hasNewUpdates={hasNewUpdates}
        onUpdatesViewed={markAsRead}
        onOpenSettings={() => {
          setIsSettingsOpen(true);
          setIsMenuOpen(false);
        }}
      />
      <SettingsDialog isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      <GlobalSearchDialog isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />

      <main className={`app-page-main app-page-main--${width}`}>
        <div className="app-page-header">
          <h1>{title}</h1>
          {subtitle && <p className="app-page-subtitle">{subtitle}</p>}
          {headerExtra && <div className="app-page-header-extra">{headerExtra}</div>}
        </div>
        {children}
      </main>
    </div>
  );
}
