"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FaBookmark,
  FaChevronLeft,
  FaHeart,
  FaHistory,
  FaMobileAlt,
  FaSignOutAlt,
  FaUsers,
} from "react-icons/fa";
import AppPage from "@/components/AppPage";
import { PoemLibraryList, useLibraryVersion } from "@/components/PoemLibraryPage";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/context/SettingsContext";
import { getInterestByKey } from "@/data/interests";
import {
  AccountError,
  fetchAccount,
  logIn,
  logOut,
  signUp,
  type AccountUser,
} from "@/utils/accountApi";
import { readFavorites, readHistory } from "@/utils/poemLibrary";
import {
  findDirectoryPoet,
  getDirectoryPoetDisplayName,
} from "@/utils/poetDirectory";
import "../styles/PoemLibrary.css";

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
    <AppPage
      title={isSignup ? "ساخت حساب" : "ورود به حساب"}
      subtitle="گنجورک بدون حساب هم کامل کار می‌کند. با حساب، همه‌چیز روی همهٔ دستگاه‌هایتان می‌ماند."
      width="narrow"
      hideSearch
    >
      <div className="app-card account-card">
        <div className="app-segmented" role="tablist" aria-label="ورود یا ثبت‌نام">
          {(["login", "signup"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
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

          {error && (
            <p className="account-error" role="alert" aria-live="assertive">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" className="account-submit" disabled={isSubmitting}>
            {isSubmitting ? "صبر کنید…" : isSignup ? "ساخت حساب" : "ورود"}
          </Button>
        </form>
      </div>

      <section className="app-section account-benefits">
        <h2 className="app-section-title">با حساب چه می‌ماند</h2>
        <ul className="app-list">
          {[
            { icon: <FaBookmark />, title: "نشان‌شده‌ها", meta: "شعرهای ذخیره‌شده" },
            { icon: <FaUsers />, title: "شاعران دنبال‌شده", meta: "و فید «دنبال‌شده‌ها»" },
            { icon: <FaHeart />, title: "علاقه‌مندی‌ها", meta: "موضوع‌های فید" },
            { icon: <FaMobileAlt />, title: "همهٔ دستگاه‌ها", meta: "تاریخچهٔ خواندن همگام می‌شود" },
          ].map((item) => (
            <li key={item.title} className="app-row">
              <span className="app-row-icon" aria-hidden="true">{item.icon}</span>
              <span className="app-row-body">
                <span className="app-row-title">{item.title}</span>
                <span className="app-row-meta">{item.meta}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </AppPage>
  );
};

const poetNameForKey = (key: string) => {
  const slug = key.slice(key.indexOf(":") + 1);
  const poet = findDirectoryPoet(slug);
  return poet ? getDirectoryPoetDisplayName(poet) : slug;
};

const persianDateFormatter = new Intl.DateTimeFormat("fa-IR", { dateStyle: "long" });

const persianNumber = new Intl.NumberFormat("fa-IR");

export const ProfilePage = () => {
  const router = useRouter();
  const { settings } = useSettings();
  const [user, setUser] = useState<AccountUser | null>(null);
  const [error, setError] = useState("");
  // Lists come from this device, which AccountSync keeps merged with the
  // account; re-render when it writes so other devices' data shows up.
  const libraryVersion = useLibraryVersion();

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

  if (!user) {
    return (
      <AppPage title="حساب من" width="narrow">
        <div className="app-empty" role={error ? "alert" : "status"}>
          <p>{error || "در حال بارگذاری حساب…"}</p>
        </div>
      </AppPage>
    );
  }

  const isReady = libraryVersion > 0;
  const history = isReady ? readHistory() : [];
  const favorites = isReady ? readFavorites() : [];
  const interests = settings.interestKeys
    .map((key) => getInterestByKey(key)?.label)
    .filter(Boolean);

  const stats = [
    { label: "ذخیره", value: favorites.length, href: "/saved" },
    { label: "دنبال‌شده", value: settings.followedPoetKeys.length, href: "/following" },
    { label: "خوانده", value: history.length, href: "/saved" },
  ];

  return (
    <AppPage title="حساب من" width="narrow">
      <div className="app-card account-hero">
        <span className="account-hero-avatar" aria-hidden="true">
          {user.displayName.trim().slice(0, 1) || "؟"}
        </span>
        <div className="account-hero-text">
          <strong>{user.displayName}</strong>
          <span>
            <span dir="ltr">@{user.username}</span>
            {" · "}
            عضو از {persianDateFormatter.format(new Date(user.createdAt))}
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="account-logout"
          onClick={async () => {
            await logOut().catch(() => undefined);
            window.location.assign("/");
          }}
        >
          <FaSignOutAlt aria-hidden="true" />
          خروج
        </Button>
        <div className="account-stats">
          {stats.map((stat) => (
            <Link key={stat.label} href={stat.href} className="account-stat">
              <strong>{persianNumber.format(stat.value)}</strong>
              <span>{stat.label}</span>
            </Link>
          ))}
        </div>
      </div>

      <section className="app-section" aria-labelledby="profile-history">
        <h2 id="profile-history" className="app-section-title">
          <span>در حال خواندن و شنیدن</span>
        </h2>
        <PoemLibraryList
          entries={history.slice(0, 5)}
          icon="history"
          emptyMessage="هنوز شعری نخوانده یا نشنیده‌اید."
        />
      </section>

      <section className="app-section" aria-labelledby="profile-favorites">
        <h2 id="profile-favorites" className="app-section-title">
          <span>پسندیده‌ها</span>
          {favorites.length > 5 && (
            <Link href="/saved" className="account-section-link">
              همه
              <FaChevronLeft aria-hidden="true" />
            </Link>
          )}
        </h2>
        <PoemLibraryList
          entries={favorites.slice(0, 5)}
          emptyMessage="هنوز شعری نپسندیده‌اید. روی آیکن قلب در صفحهٔ شعر بزنید."
        />
      </section>

      <section className="app-section" aria-labelledby="profile-poets">
        <h2 id="profile-poets" className="app-section-title">
          <span>شاعران دنبال‌شده</span>
          <Link href="/following" className="account-section-link">
            مدیریت
            <FaChevronLeft aria-hidden="true" />
          </Link>
        </h2>
        <div className="app-card app-card-pad">
          {settings.followedPoetKeys.length > 0 ? (
            <ul className="account-chips">
              {settings.followedPoetKeys.map((key) => (
                <li key={key}>{poetNameForKey(key)}</li>
              ))}
            </ul>
          ) : (
            <p className="app-row-meta">هنوز شاعری را دنبال نمی‌کنید.</p>
          )}
        </div>
      </section>

      <section className="app-section" aria-labelledby="profile-interests">
        <h2 id="profile-interests" className="app-section-title">
          <span>علاقه‌مندی‌ها</span>
          <Link href="/?interests=1" className="account-section-link">
            ویرایش
            <FaChevronLeft aria-hidden="true" />
          </Link>
        </h2>
        <div className="app-card app-card-pad">
          {interests.length > 0 ? (
            <ul className="account-chips">
              {interests.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          ) : (
            <p className="app-row-meta">هنوز علاقه‌مندی‌ای انتخاب نکرده‌اید.</p>
          )}
        </div>
      </section>
    </AppPage>
  );
};
