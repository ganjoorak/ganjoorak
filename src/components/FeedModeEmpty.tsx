"use client";

import { useState, type ReactNode } from "react";
import Menu, { MenuButton, SearchButton } from "@/components/Menu";
import SettingsDialog from "@/components/SettingsDialog";
import GlobalSearchDialog from "@/components/GlobalSearchDialog";
import { useUpdateNotification } from "@/hooks/useUpdateNotification";

interface FeedModeEmptyProps {
  switcher: ReactNode;
  icon: ReactNode;
  title: string;
  description: string;
  actions: ReactNode;
}

/** Full-screen feed state used when the active mode has nothing to show. */
const FeedModeEmpty = ({ switcher, icon, title, description, actions }: FeedModeEmptyProps) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const { hasNewUpdates, markAsRead } = useUpdateNotification();

  return (
    <div className="feed-mode-empty-page" dir="rtl">
      <MenuButton onClick={() => setIsMenuOpen(true)} hasNotification={hasNewUpdates} />
      <SearchButton onClick={() => setIsSearchOpen(true)} />
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

      <main className="feed-mode-empty-shell">
        <div className="feed-mode-empty-switch">{switcher}</div>
        <section className="feed-mode-empty-card" aria-live="polite">
          <span className="feed-mode-empty-icon" aria-hidden="true">
            {icon}
          </span>
          <h1>{title}</h1>
          <p>{description}</p>
          <div className="feed-mode-empty-actions">{actions}</div>
        </section>
      </main>
    </div>
  );
};

export default FeedModeEmpty;
