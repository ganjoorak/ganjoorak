"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FaChevronLeft, FaSlidersH, FaUserPlus, FaUsers } from "react-icons/fa";
import Menu, { MenuButton, SearchButton } from "@/components/Menu";
import SettingsDialog from "@/components/SettingsDialog";
import GlobalSearchDialog from "@/components/GlobalSearchDialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { useUpdateNotification } from "@/hooks/useUpdateNotification";
import { useFollowedPoetKeys } from "@/hooks/useFollowPoet";
import {
  findDirectoryPoet,
  getDirectoryPoetDisplayName,
  loadPoetDirectory,
  subscribePoetDirectory,
} from "@/utils/poetDirectory";
import "../styles/PoemLibrary.css";

const SOURCE_LABELS: Record<string, string> = {
  ganjoor: "گنجور",
  custom: "گنجورک",
  echolalia: "اکولالیا",
};

const persianNumber = new Intl.NumberFormat("fa-IR");

const FollowingPage = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [, setDirectoryVersion] = useState(0);
  const { hasNewUpdates, markAsRead } = useUpdateNotification();
  const { keys, unfollow } = useFollowedPoetKeys();

  useEffect(() => {
    const unsubscribe = subscribePoetDirectory(() =>
      setDirectoryVersion((value) => value + 1),
    );
    void loadPoetDirectory();
    return unsubscribe;
  }, []);

  const poets = keys.map((key) => {
    const separator = key.indexOf(":");
    const source = separator > 0 ? key.slice(0, separator) : "ganjoor";
    const slug = key.slice(separator + 1);
    const poet = findDirectoryPoet(slug);
    return {
      key,
      slug,
      source,
      name: poet ? getDirectoryPoetDisplayName(poet) : slug,
      fullName: poet && poet.nickname && poet.nickname !== poet.name ? poet.name : null,
      imageUrl: poet?.imageUrl ?? null,
      href: `/${poet?.urlSlug ?? slug}`,
    };
  });

  return (
    <div className="poem-library-page" dir="rtl">
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

      <main className="poem-library-shell">
        <header className="poem-library-header following-header">
          <h1>شاعران دنبال‌شده</h1>
          <p>
            {keys.length > 0
              ? `${persianNumber.format(keys.length)} شاعر. فید صفحهٔ اصلی بیشتر از همین شاعران شعر می‌آورد.`
              : "شاعرانی که دنبال می‌کنید اینجا جمع می‌شوند و فید صفحهٔ اصلی بیشتر از آن‌ها شعر می‌آورد."}
          </p>
        </header>

        {poets.length > 0 ? (
          <>
            <ul className="following-list">
              {poets.map((poet) => (
                <li key={poet.key} className="following-item">
                  <Link href={poet.href} className="following-link" prefetch={false}>
                    <span className="following-avatar" aria-hidden="true">
                      {poet.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={poet.imageUrl} alt="" loading="lazy" />
                      ) : (
                        <span>{poet.name.slice(0, 1)}</span>
                      )}
                    </span>
                    <span className="following-text">
                      <strong>{poet.name}</strong>
                      <span>
                        {[poet.fullName, SOURCE_LABELS[poet.source]].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <FaChevronLeft className="following-chevron" aria-hidden="true" />
                  </Link>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => unfollow(poet.key)}
                    aria-label={`لغو دنبال کردن ${poet.name}`}
                  >
                    لغو دنبال
                  </Button>
                </li>
              ))}
            </ul>
            <div className="following-actions">
              <Link href="/poets" className={buttonVariants({ variant: "secondary", size: "lg" })}>
                  <FaUserPlus aria-hidden="true" />
                  پیدا کردن شاعر تازه
                </Link>
              <Link href="/?feed=1" className={buttonVariants({ variant: "ghost", size: "lg" })}>
                  <FaSlidersH aria-hidden="true" />
                  ویرایش گروهی فید
                </Link>
            </div>
          </>
        ) : (
          <div className="following-empty">
            <span className="following-empty-icon" aria-hidden="true">
              <FaUsers />
            </span>
            <p>هنوز شاعری را دنبال نمی‌کنید. در صفحهٔ هر شاعر دکمهٔ «دنبال کردن» را بزنید.</p>
            <Link href="/poets" className={buttonVariants({ size: "lg" })}>
                <FaUserPlus aria-hidden="true" />
                دیدن شاعران
              </Link>
          </div>
        )}
      </main>
    </div>
  );
};

export default FollowingPage;
