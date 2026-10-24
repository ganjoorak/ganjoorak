"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FaArrowRight,
  FaChevronLeft,
  FaEye,
  FaEyeSlash,
  FaSignOutAlt,
} from "react-icons/fa";
import AppPage from "@/components/AppPage";
import { PoemLibraryList, useLibraryVersion } from "@/components/PoemLibraryPage";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { FormError } from "@/components/ui/form-error";
import { Input } from "@/components/ui/input";
import { FieldHint, Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { useSettings } from "@/context/SettingsContext";
import {
  AccountError,
  fetchAccount,
  logIn,
  logOut,
  signUp,
  type AccountUser,
} from "@/utils/accountApi";
import { readFavorites, readHistory } from "@/utils/poemLibrary";
import "../styles/PoemLibrary.css";

type AuthMode = "login" | "signup";

const AUTH_VERSES = [
  { poet: "حافظ", lines: ["هرگز نمیرد آن که دلش زنده شد به عشق", "ثبت است بر جریدهٔ عالم دوام ما"] },
  { poet: "مولانا", lines: ["بشنو این نی چون شکایت می‌کند", "از جدایی‌ها حکایت می‌کند"] },
  { poet: "سعدی", lines: ["بنی‌آدم اعضای یک پیکرند", "که در آفرینش ز یک گوهرند"] },
  { poet: "باباطاهر", lines: ["ز دست دیده و دل هر دو فریاد", "که هر چه دیده بیند دل کند یاد"] },
  { poet: "فردوسی", lines: ["توانا بود هر که دانا بود", "ز دانش دل پیر برنا بود"] },
];

export const LoginPage = () => {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // Null until mount: picking a verse during render would differ between the
  // server HTML and the first client render.
  const [verseIndex, setVerseIndex] = useState<number | null>(null);

  useEffect(() => {
    setVerseIndex(Math.floor(Math.random() * AUTH_VERSES.length));
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

  const handleBack = () => {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  };

  const isSignup = mode === "signup";

  return (
    <div className="auth-page" dir="rtl">
      <main className="auth-main">
        <Button
          variant="ghost"
          size="icon-lg"
          className="auth-back"
          onClick={handleBack}
          aria-label="بازگشت"
        >
          <FaArrowRight />
        </Button>
        <div className="auth-main-inner">
          <header className="auth-header">
            <h1>{isSignup ? "ساخت حساب" : "ورود به حساب"}</h1>
            <p>
              گنجورک بدون حساب هم کامل کار می‌کند. با حساب، همه‌چیز روی همهٔ دستگاه‌هایتان
              می‌ماند.
            </p>
          </header>

          <Card className="auth-card">
            <Tabs
              value={mode}
              onValueChange={(value) => {
                setMode(value as typeof mode);
                setError("");
              }}
            >
              <TabsList aria-label="ورود یا ثبت‌نام">
                {(["login", "signup"] as const).map((value) => (
                  <TabsTab key={value} value={value}>
                    {value === "login" ? "ورود" : "ثبت‌نام"}
                  </TabsTab>
                ))}
              </TabsList>
            </Tabs>

            <form className="account-form" onSubmit={handleSubmit}>
              <Label>
                <span>نام کاربری</span>
                <Input
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
                  onChange={(event) => {
                    setError("");
                    setUsername(event.target.value);
                  }}
                />
                {isSignup && <FieldHint>حروف لاتین، رقم یا _ (۳ تا ۳۲ نویسه)</FieldHint>}
              </Label>

              {isSignup && (
                <Label>
                  <span>نام نمایشی (اختیاری)</span>
                  <Input
                    name="displayName"
                    autoComplete="nickname"
                    maxLength={50}
                    value={displayName}
                    onChange={(event) => {
                      setError("");
                      setDisplayName(event.target.value);
                    }}
                  />
                </Label>
              )}

              <Label>
                <span>گذرواژه</span>
                <div className="auth-password">
                  <Input
                    name="password"
                    type={showPassword ? "text" : "password"}
                    dir="ltr"
                    autoComplete={isSignup ? "new-password" : "current-password"}
                    required
                    minLength={isSignup ? 8 : undefined}
                    maxLength={128}
                    value={password}
                    className="auth-password-input"
                    onChange={(event) => {
                      setError("");
                      setPassword(event.target.value);
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="auth-password-toggle"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? "پنهان‌کردن گذرواژه" : "نمایش گذرواژه"}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <FaEyeSlash aria-hidden="true" /> : <FaEye aria-hidden="true" />}
                  </Button>
                </div>
                {isSignup && <FieldHint>دست‌کم ۸ نویسه</FieldHint>}
              </Label>

              {error && (
                <FormError>{error}</FormError>
              )}

              <Button
                type="submit"
                size="lg"
                className="auth-submit"
                loading={isSubmitting}
              >
                {isSignup ? "ساخت حساب" : "ورود"}
              </Button>
            </form>
          </Card>

          <p className="auth-benefits">
            نشان‌شده‌ها، شاعران دنبال‌شده و تاریخچهٔ خواندن، روی همهٔ دستگاه‌هایتان
            می‌ماند.
          </p>
        </div>
      </main>

      <aside className="auth-hero">
        {verseIndex !== null && (
          <figure className="auth-hero-verse" key={verseIndex}>
            <blockquote>
              {AUTH_VERSES[verseIndex].lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </blockquote>
            <figcaption className="auth-hero-poet">{AUTH_VERSES[verseIndex].poet}</figcaption>
          </figure>
        )}
        <div className="auth-hero-brand">
          <span className="auth-hero-logo">گنجورک</span>
          <p className="auth-hero-tagline">راحت‌تر شعر بخوانیم و شعر گوش دهیم.</p>
          <span className="auth-hero-domain" dir="ltr">ganjoorak.ir</span>
        </div>
      </aside>
    </div>
  );
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
        <Empty role={error ? "alert" : "status"}>
          <EmptyDescription>{error || "در حال بارگذاری حساب…"}</EmptyDescription>
        </Empty>
      </AppPage>
    );
  }

  const isReady = libraryVersion > 0;
  const history = isReady ? readHistory() : [];
  const favorites = isReady ? readFavorites() : [];

  const stats = [
    { label: "ذخیره", value: favorites.length, href: "/saved" },
    { label: "دنبال‌شده", value: settings.followedPoetKeys.length, href: "/following" },
    { label: "خوانده", value: history.length, href: "/saved" },
  ];

  return (
    <AppPage title="حساب من" width="narrow">
      <Card className="account-hero">
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
      </Card>

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
    </AppPage>
  );
};
