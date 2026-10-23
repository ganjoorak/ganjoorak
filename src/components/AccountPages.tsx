"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FaSignOutAlt } from "react-icons/fa";
import Menu, { MenuButton, SearchButton } from "@/components/Menu";
import SettingsDialog from "@/components/SettingsDialog";
import GlobalSearchDialog from "@/components/GlobalSearchDialog";
import { PoemLibraryList } from "@/components/PoemLibraryPage";
import { useSettings } from "@/context/SettingsContext";
import { getInterestByKey } from "@/data/interests";
import { useUpdateNotification } from "@/hooks/useUpdateNotification";
import {
  AccountError,
  fetchAccount,
  logIn,
  logOut,
  signUp,
  type AccountUser,
} from "@/utils/accountApi";
import {
  LIBRARY_CHANGE_EVENT,
  readFavorites,
  readHistory,
} from "@/utils/poemLibrary";
import {
  findDirectoryPoet,
  getDirectoryPoetDisplayName,
} from "@/utils/poetDirectory";
import "../styles/PoemLibrary.css";

/** Same page chrome as the saved-poems page. */
const AccountShell = ({ children }: { children: ReactNode }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const { hasNewUpdates, markAsRead } = useUpdateNotification();

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
      <main className="poem-library-shell">{children}</main>
    </div>
  );
};

type AuthMode = "login" | "signup";

export const LoginPage = () => {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchAccount()
      .then(() => router.replace("/profile"))
      .catch(() => undefined);
  }, [router]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      if (mode === "signup") {
        await signUp(username, password, displayName);
      } else {
        await logIn(username, password);
      }
      // A full load remounts AccountSync, which merges this device into the account.
      window.location.assign("/profile");
    } catch (caught) {
      setError(caught instanceof AccountError ? caught.message : "خطایی رخ داد.");
      setIsSubmitting(false);
    }
  };

  const isSignup = mode === "signup";

  return (
    <AccountShell>
      <header className="poem-library-header">
        <h1>{isSignup ? "ساخت حساب" : "ورود به حساب"}</h1>
        <p>
          گنجورک بدون حساب هم کامل کار می‌کند. با حساب، نشان‌شده‌ها، شاعران
          دنبال‌شده، علاقه‌مندی‌ها و تاریخچهٔ خواندن روی همهٔ دستگاه‌هایتان
          می‌ماند.
        </p>
      </header>

      <div className="poem-library-tabs" role="tablist">
        {(["login", "signup"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            className={mode === value ? "active" : ""}
            aria-selected={mode === value}
            onClick={() => {
              setMode(value);
              setError("");
            }}
          >
            {value === "login" ? "ورود" : "ثبت‌نام"}
          </button>
        ))}
      </div>

      <form className="account-form" onSubmit={handleSubmit}>
        <label className="account-field">
          <span>نام کاربری</span>
          <input
            name="username"
            dir="ltr"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            minLength={3}
            maxLength={32}
            pattern="[A-Za-z0-9_]+"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          {isSignup && <small>حروف لاتین، رقم یا _ (۳ تا ۳۲ نویسه)</small>}
        </label>

        {isSignup && (
          <label className="account-field">
            <span>نام نمایشی (اختیاری)</span>
            <input
              name="displayName"
              autoComplete="nickname"
              maxLength={50}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
        )}

        <label className="account-field">
          <span>گذرواژه</span>
          <input
            name="password"
            type="password"
            dir="ltr"
            autoComplete={isSignup ? "new-password" : "current-password"}
            required
            minLength={isSignup ? 8 : undefined}
            maxLength={128}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {isSignup && <small>دست‌کم ۸ نویسه</small>}
        </label>

        <p className="account-error" role="alert" aria-live="assertive">
          {error}
        </p>

        <button type="submit" className="account-primary" disabled={isSubmitting}>
          {isSubmitting ? "صبر کنید…" : isSignup ? "ساخت حساب" : "ورود"}
        </button>
      </form>
    </AccountShell>
  );
};

const poetNameForKey = (key: string) => {
  const slug = key.slice(key.indexOf(":") + 1);
  const poet = findDirectoryPoet(slug);
  return poet ? getDirectoryPoetDisplayName(poet) : slug;
};

const persianDateFormatter = new Intl.DateTimeFormat("fa-IR", { dateStyle: "long" });

export const ProfilePage = () => {
  const router = useRouter();
  const { settings } = useSettings();
  const [user, setUser] = useState<AccountUser | null>(null);
  const [error, setError] = useState("");
  const [, setLibraryVersion] = useState(0);

  useEffect(() => {
    fetchAccount()
      .then(({ user: account }) => setUser(account))
      .catch((caught) => {
        if (caught instanceof AccountError && caught.status === 401) {
          router.replace("/login");
        } else {
          setError(caught instanceof AccountError ? caught.message : "خطایی رخ داد.");
        }
      });
  }, [router]);

  // Lists come from this device, which AccountSync keeps merged with the
  // account; re-render when it writes so other devices' data shows up.
  useEffect(() => {
    const refresh = () => setLibraryVersion((value) => value + 1);
    window.addEventListener(LIBRARY_CHANGE_EVENT, refresh);
    return () => window.removeEventListener(LIBRARY_CHANGE_EVENT, refresh);
  }, []);

  if (!user) {
    return (
      <AccountShell>
        <p className="poem-library-empty" role={error ? "alert" : "status"}>
          {error || "در حال بارگذاری حساب…"}
        </p>
      </AccountShell>
    );
  }

  const interests = settings.interestKeys
    .map((key) => getInterestByKey(key)?.label)
    .filter(Boolean);

  return (
    <AccountShell>
      <header className="poem-library-header account-profile-header">
        <div>
          <h1>{user.displayName}</h1>
          <p>
            <span dir="ltr">@{user.username}</span>
            {" · "}
            عضو از {persianDateFormatter.format(new Date(user.createdAt))}
          </p>
        </div>
        <button
          type="button"
          className="account-secondary"
          onClick={async () => {
            await logOut().catch(() => undefined);
            window.location.assign("/");
          }}
        >
          <FaSignOutAlt aria-hidden="true" />
          خروج
        </button>
      </header>

      <section className="account-section" aria-labelledby="profile-history">
        <h2 id="profile-history">در حال خواندن و شنیدن</h2>
        <PoemLibraryList
          entries={readHistory().slice(0, 10)}
          emptyMessage="هنوز شعری نخوانده یا نشنیده‌اید."
        />
      </section>

      <section className="account-section" aria-labelledby="profile-favorites">
        <h2 id="profile-favorites">پسندیده‌ها</h2>
        <PoemLibraryList
          entries={readFavorites()}
          emptyMessage="هنوز شعری نپسندیده‌اید. روی آیکن قلب در صفحهٔ شعر بزنید."
        />
      </section>

      <section className="account-section" aria-labelledby="profile-poets">
        <h2 id="profile-poets">
          <Link href="/following">شاعران دنبال‌شده</Link>
        </h2>
        {settings.followedPoetKeys.length > 0 ? (
          <ul className="account-chips">
            {settings.followedPoetKeys.map((key) => (
              <li key={key}>{poetNameForKey(key)}</li>
            ))}
          </ul>
        ) : (
          <p className="poem-library-empty">هنوز شاعری را دنبال نمی‌کنید.</p>
        )}
      </section>

      <section className="account-section" aria-labelledby="profile-interests">
        <h2 id="profile-interests">علاقه‌مندی‌ها</h2>
        {interests.length > 0 ? (
          <ul className="account-chips">
            {interests.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        ) : (
          <p className="poem-library-empty">هنوز علاقه‌مندی‌ای انتخاب نکرده‌اید.</p>
        )}
      </section>
    </AccountShell>
  );
};
