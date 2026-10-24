"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FaArrowRight } from "react-icons/fa";
import { Button } from "@/components/ui/button";
import "../styles/AppPage.css";

interface AppPageProps {
  title: string;
  subtitle?: ReactNode;
  /** Extra controls rendered under the large title (search field, tabs...). */
  headerExtra?: ReactNode;
  /** Buttons placed at the end of the top bar. */
  actions?: ReactNode;
  /** Where «بازگشت» goes when there is no history to pop. */
  backHref?: string;
  width?: "narrow" | "default" | "wide";
  className?: string;
  children: ReactNode;
}

/**
 * Shared app-style page: a sticky top bar (back, title that fades in on scroll,
 * page actions) over a large title header and mobile-first content.
 */
export default function AppPage({
  title,
  subtitle,
  headerExtra,
  actions,
  backHref = "/",
  width = "default",
  className,
  children,
}: AppPageProps) {
  const router = useRouter();
  const [isScrolled, setIsScrolled] = useState(false);

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
        <div className="app-page-bar-actions">{actions}</div>
      </header>

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
