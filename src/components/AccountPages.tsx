"use client";

import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FaArrowRight,
  FaCheck,
  FaCog,
  FaChevronLeft,
  FaEye,
  FaEyeSlash,
  FaHistory,
  FaShareAlt,
  FaSignOutAlt,
} from "react-icons/fa";
import AppPage from "@/components/AppPage";
import ProfileAvatar from "@/components/ProfileAvatar";
import RecoveryCodePanel from "@/components/RecoveryCodePanel";
import { CollectionList, PoemLibraryList, useLibraryVersion } from "@/components/PoemLibraryPage";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import FollowUserButton from "@/components/FollowUserButton";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { FormError } from "@/components/ui/form-error";
import { Input } from "@/components/ui/input";
import { FieldHint, Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsIndicator, TabsList, TabsTab } from "@/components/ui/tabs";
import {
  AccountError,
  fetchAccount,
  logIn,
  logOut,
  publicProfilePath,
  resetPassword,
  setProfileVisibility,
  signUp,
  type AccountUser,
  type FollowCounts,
  type PublicProfile,
} from "@/utils/accountApi";
import { readLovedCollections } from "@/utils/collectionLibrary";
import { readFavorites, readHistory, type PoemLibraryEntry } from "@/utils/poemLibrary";
import "../styles/PoemLibrary.css";

type AuthMode = "login" | "signup";

/**
 * Signup-only content that expands and fades in instead of popping in. It stays mounted so the height can
 * animate; while closed it is hidden from assistive tech and its inputs are disabled by the caller.
 * `gap` is the parent's gap, pulled back while closed so the collapsed row takes no space.
 */
const AuthReveal = ({ open, gap, children }: { open: boolean; gap: string; children: ReactNode }) => (
  <div
    className="auth-reveal"
    data-open={open}
    aria-hidden={!open}
    style={{ "--auth-reveal-gap": gap } as CSSProperties}
  >
    <div className="auth-reveal-inner">{children}</div>
  </div>
);

/** Password input with a show/hide toggle; the input is LTR inside the RTL form. */
export const PasswordField = ({
  name,
  value,
  onChange,
  autoComplete,
  minLength,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  minLength?: number;
}) => {
  const [visible, setVisible] = useState(false);
  return (
    <div className="auth-password">
      <Input
        name={name}
        type={visible ? "text" : "password"}
        dir="ltr"
        autoComplete={autoComplete}
        required
        minLength={minLength}
        maxLength={128}
        value={value}
        className="auth-password-input"
        onChange={(event) => onChange(event.target.value)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="auth-password-toggle"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? "پنهان‌کردن گذرواژه" : "نمایش گذرواژه"}
        aria-pressed={visible}
      >
        {visible ? <FaEyeSlash aria-hidden="true" /> : <FaEye aria-hidden="true" />}
      </Button>
    </div>
  );
};

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
  // "reset" is forgot-password: username + recovery code + new password.
  const [view, setView] = useState<"auth" | "reset">("auth");
  const [recoveryInput, setRecoveryInput] = useState("");
  // A code the service just issued (sign-up or reset), shown once before continuing.
  const [issuedCode, setIssuedCode] = useState("");
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
      if (view === "reset") {
        const { recoveryCode } = await resetPassword(username, recoveryInput, password);
        setIssuedCode(recoveryCode);
        setIsSubmitting(false);
        return;
      }
      if (mode === "signup") {
        const { recoveryCode } = await signUp(username, password, displayName);
        setIssuedCode(recoveryCode);
        setIsSubmitting(false);
        return;
      }
      await logIn(username, password);
      continueToProfile();
    } catch (caught) {
      setError(caught instanceof AccountError ? caught.message : "خطایی رخ داد.");
      setIsSubmitting(false);
    }
  };

  // A full load remounts AccountSync, which merges this device into the account.
  const continueToProfile = () => window.location.assign("/profile");

  const handleBack = () => {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  };

  const isSignup = mode === "signup";
  const isReset = view === "reset";
  const titleKey = issuedCode ? "code" : isReset ? "reset" : mode;
  const title = issuedCode
    ? "کد بازیابی شما"
    : isReset
      ? "بازیابی گذرواژه"
      : isSignup
        ? "ساخت حساب"
        : "ورود به حساب";

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
            <h1 key={titleKey} className="auth-swap">{title}</h1>
            <p>
              {isReset && !issuedCode
                ? "نام کاربری و کد بازیابی‌ای را که هنگام ساخت حساب گرفتید وارد کنید و گذرواژهٔ تازه بگذارید."
                : "گنجورک بدون حساب هم کامل کار می‌کند. با حساب، همه‌چیز روی همهٔ دستگاه‌هایتان می‌ماند."}
            </p>
          </header>

          <Card className="auth-card">
            {issuedCode ? (
              <RecoveryCodePanel code={issuedCode} doneLabel="ادامه" onDone={continueToProfile} />
            ) : isReset ? (
              <form className="account-form" onSubmit={handleSubmit}>
                <Label className="flex flex-col">
                  <span>نام کاربری</span>
                  <Input
                    name="username"
                    dir="ltr"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                    value={username}
                    onChange={(event) => {
                      setError("");
                      setUsername(event.target.value);
                    }}
                  />
                </Label>
                <Label className="flex flex-col">
                  <span>کد بازیابی</span>
                  <Input
                    name="recoveryCode"
                    dir="ltr"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    required
                    maxLength={64}
                    placeholder="XXXX-XXXX-XXXX-XXXX"
                    value={recoveryInput}
                    onChange={(event) => {
                      setError("");
                      setRecoveryInput(event.target.value);
                    }}
                  />
                </Label>
                <Label className="flex flex-col">
                  <span>گذرواژهٔ تازه</span>
                  <PasswordField
                    name="newPassword"
                    value={password}
                    onChange={(value) => {
                      setError("");
                      setPassword(value);
                    }}
                    autoComplete="new-password"
                    minLength={8}
                  />
                  <FieldHint>دست‌کم ۸ نویسه</FieldHint>
                </Label>
                {error && <FormError>{error}</FormError>}
                <Button type="submit" size="lg" className="auth-submit" loading={isSubmitting}>
                  تغییر گذرواژه
                </Button>
                <button
                  type="button"
                  className="auth-text-button"
                  onClick={() => {
                    setView("auth");
                    setError("");
                    setPassword("");
                  }}
                >
                  بازگشت به ورود
                </button>
              </form>
            ) : (
              <>
                <Tabs
                  value={mode}
                  onValueChange={(value) => {
                    setMode(value as typeof mode);
                    setError("");
                  }}
                >
                  <TabsList aria-label="ورود یا ثبت‌نام" className="relative">
                    <TabsIndicator />
                    {(["login", "signup"] as const).map((value) => (
                      <TabsTab
                        key={value}
                        value={value}
                        className="relative data-active:bg-transparent data-active:shadow-none"
                      >
                        {value === "login" ? "ورود" : "ثبت‌نام"}
                      </TabsTab>
                    ))}
                  </TabsList>
                </Tabs>

                <form className="account-form" onSubmit={handleSubmit}>
                  <Label className="flex flex-col">
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
                    <AuthReveal open={isSignup} gap="0.375rem">
                      <FieldHint>حروف لاتین، رقم یا _ (۳ تا ۳۲ نویسه)</FieldHint>
                    </AuthReveal>
                  </Label>

                  <AuthReveal open={isSignup} gap="1rem">
                    <Label>
                      <span>نام نمایشی (اختیاری)</span>
                      <Input
                        name="displayName"
                        autoComplete="nickname"
                        maxLength={50}
                        disabled={!isSignup}
                        value={displayName}
                        onChange={(event) => {
                          setError("");
                          setDisplayName(event.target.value);
                        }}
                      />
                    </Label>
                  </AuthReveal>

                  <Label className="flex flex-col">
                    <span>گذرواژه</span>
                    <PasswordField
                      name="password"
                      value={password}
                      onChange={(value) => {
                        setError("");
                        setPassword(value);
                      }}
                      autoComplete={isSignup ? "new-password" : "current-password"}
                      minLength={isSignup ? 8 : undefined}
                    />
                    <AuthReveal open={isSignup} gap="0.375rem">
                      <FieldHint>دست‌کم ۸ نویسه</FieldHint>
                    </AuthReveal>
                  </Label>

                  <AuthReveal open={!isSignup} gap="1rem">
                    <button
                      type="button"
                      className="auth-text-button"
                      tabIndex={isSignup ? -1 : undefined}
                      onClick={() => {
                        setView("reset");
                        setError("");
                        setPassword("");
                      }}
                    >
                      گذرواژه را فراموش کرده‌اید؟
                    </button>
                  </AuthReveal>

                  {error && (
                    <FormError>{error}</FormError>
                  )}

                  <Button
                    type="submit"
                    size="lg"
                    className="auth-submit"
                    loading={isSubmitting}
                  >
                    <span key={mode} className="auth-swap">{isSignup ? "ساخت حساب" : "ورود"}</span>
                  </Button>
                </form>
              </>
            )}
          </Card>

          <p className="auth-benefits">
            نشان‌شده‌ها، شاعران مورد علاقه و تاریخچهٔ خواندن، روی همهٔ دستگاه‌هایتان
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

// Mirrors readingWindow in backend/account.go, for the owner's own preview.
const READING_WINDOW_MS = 20 * 60 * 1000;
const OWNER_FAVORITES_SHOWN = 5;

type ProfileSummary = Omit<PublicProfile, "favoriteCount" | "followerCount" | "followingCount"> & {
  favoriteCount?: number;
  followerCount?: number;
  followingCount?: number;
};

const ProfilePoem = ({ entry, live }: { entry: PoemLibraryEntry; live?: boolean }) => (
  <Link
    href={entry.href}
    prefetch={false}
    className={`app-row profile-poem${live ? " profile-poem--live" : ""}`}
  >
    <span className="app-row-icon" aria-hidden="true">
      {live ? <span className="profile-live-dot" /> : <FaHistory />}
    </span>
    <span className="app-row-body">
      <span className="app-row-title">{entry.title}</span>
      {entry.excerpt && <span className="library-excerpt">{entry.excerpt}</span>}
      <span className="app-row-meta">{entry.poetName}</span>
    </span>
    <FaChevronLeft className="app-row-chevron" aria-hidden="true" />
  </Link>
);

/** Counts are public; only the owner may open the lists behind them. */
const FollowCount = ({ href, count, label }: { href?: string; count: number; label: string }) => {
  const content = (
    <>
      <strong>{persianNumber.format(count)}</strong> {label}
    </>
  );
  return href ? (
    <Link href={href} className="account-hero-follow-link">
      {content}
    </Link>
  ) : (
    <span>{content}</span>
  );
};

/**
 * The profile body shared by the owner's /profile and the public /@username:
 * the poem being read now, the last poem, and liked poems. Preferred poets and
 * the full history stay private.
 */
const ProfileView = ({
  profile,
  heroActions,
  favoritesHref,
  favoritesLimit,
  isOwner,
  children,
}: {
  profile: ProfileSummary;
  heroActions?: ReactNode;
  /** Link to the full list when only part of it is shown. */
  favoritesHref?: string;
  favoritesLimit?: number;
  isOwner: boolean;
  children?: ReactNode;
}) => {
  const favorites = favoritesLimit ? profile.favorites.slice(0, favoritesLimit) : profile.favorites;
  const favoriteCount = profile.favoriteCount ?? profile.favorites.length;
  const hiddenFavorites = favoriteCount - favorites.length;

  return (
    <>
      <Card className="account-hero">
        <ProfileAvatar username={profile.username} avatar={profile.avatar} className="account-hero-avatar" />
        <div className="account-hero-text">
          <strong>{profile.displayName}</strong>
          <span>
            <span dir="ltr">@{profile.username}</span>
            {" · "}
            عضو از {persianDateFormatter.format(new Date(profile.createdAt))}
          </span>
          {profile.followerCount !== undefined && profile.followingCount !== undefined && (
            <span className="account-hero-follows">
              <FollowCount href={isOwner ? "/following?tab=followers" : undefined} count={profile.followerCount} label="دنبال‌کننده" />
              {" · "}
              <FollowCount href={isOwner ? "/following" : undefined} count={profile.followingCount} label="دنبال‌شده" />
            </span>
          )}
        </div>
        {heroActions}
      </Card>

      {children}

      {profile.nowReading && (
        <section className="app-section" aria-labelledby="profile-reading">
          <h2 id="profile-reading" className="app-section-title">
            <span>در حال خواندن</span>
          </h2>
          <div className="app-list">
            <ProfilePoem entry={profile.nowReading} live />
          </div>
        </section>
      )}

      {(profile.lastPoem || !profile.nowReading) && (
        <section className="app-section" aria-labelledby="profile-last-poem">
          <h2 id="profile-last-poem" className="app-section-title">
            <span>آخرین شعر</span>
          </h2>
          {profile.lastPoem ? (
            <div className="app-list">
              <ProfilePoem entry={profile.lastPoem} />
            </div>
          ) : (
            <Empty>
              <EmptyDescription>
                {isOwner ? "هنوز شعری نخوانده یا نشنیده‌اید." : "هنوز شعری نخوانده است."}
              </EmptyDescription>
            </Empty>
          )}
        </section>
      )}

      {(profile.lovedCollections.length > 0 || isOwner) && (
        <section className="app-section" aria-labelledby="profile-books">
          <h2 id="profile-books" className="app-section-title">
            <span>کتاب‌های دوست‌داشتنی</span>
          </h2>
          <CollectionList
            entries={profile.lovedCollections}
            emptyMessage="هنوز کتابی را دوست نداشته‌اید. در صفحهٔ هر شاعر روی قلبِ کنار مجموعه بزنید."
          />
        </section>
      )}

      <section className="app-section" aria-labelledby="profile-favorites">
        <h2 id="profile-favorites" className="app-section-title">
          <span>
            پسندیده‌ها
            {favoriteCount > 0 && (
              <span className="profile-count"> ({persianNumber.format(favoriteCount)})</span>
            )}
          </span>
          {favoritesHref && hiddenFavorites > 0 && (
            <Link href={favoritesHref} className="account-section-link">
              همه
              <FaChevronLeft aria-hidden="true" />
            </Link>
          )}
        </h2>
        <PoemLibraryList
          entries={favorites}
          icon="heart"
          emptyMessage={
            isOwner
              ? "هنوز شعری نپسندیده‌اید. روی آیکن قلب در صفحهٔ شعر بزنید."
              : "هنوز شعری نپسندیده است."
          }
        />
        {!favoritesHref && hiddenFavorites > 0 && (
          <p className="profile-more">
            و {persianNumber.format(hiddenFavorites)} شعر دیگر
          </p>
        )}
      </section>
    </>
  );
};

const ShareProfileButton = ({ profile }: { profile: Pick<PublicProfile, "username" | "displayName"> }) => {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    const url = `${window.location.origin}${publicProfilePath(profile.username)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `${profile.displayName} در گنجورک`, url });
        return;
      }
      await navigator.clipboard?.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // The share sheet was dismissed; nothing to do.
    }
  };

  return (
    <Button type="button" variant="outline" size="sm" className="account-pill" onClick={handleShare}>
      {copied ? <FaCheck aria-hidden="true" /> : <FaShareAlt aria-hidden="true" />}
      {copied ? "کپی شد" : "اشتراک"}
    </Button>
  );
};

export const ProfilePage = () => {
  const router = useRouter();
  const [user, setUser] = useState<AccountUser | null>(null);
  const [follows, setFollows] = useState<FollowCounts | null>(null);
  const [error, setError] = useState("");
  const [visibilityError, setVisibilityError] = useState("");
  const [isSavingVisibility, setIsSavingVisibility] = useState(false);
  // When the page opened; "now reading" is judged against it.
  const [openedAt, setOpenedAt] = useState(0);
  // Lists come from this device, which AccountSync keeps merged with the
  // account; re-render when it writes so other devices' data shows up.
  const libraryVersion = useLibraryVersion();

  useEffect(() => {
    fetchAccount()
      .then(({ user: account, follows: counts }) => {
        setOpenedAt(Date.now());
        setUser(account);
        setFollows(counts);
      })
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
  // Same rule the service applies for visitors (backend/account.go), so this
  // page previews what /@username shows.
  const isReadingNow = history.length > 0 && openedAt - history[0].savedAt < READING_WINDOW_MS;
  const profile: ProfileSummary = {
    ...user,
    nowReading: isReadingNow ? history[0] : null,
    lastPoem: history[isReadingNow ? 1 : 0] ?? null,
    favorites,
    lovedCollections: isReady ? readLovedCollections() : [],
    followerCount: follows?.followers,
    followingCount: follows?.following,
  };
  const profilePath = publicProfilePath(user.username);

  const handleVisibility = async (isPublic: boolean) => {
    setVisibilityError("");
    setIsSavingVisibility(true);
    try {
      const { user: account } = await setProfileVisibility(isPublic);
      setUser(account);
    } catch (caught) {
      setVisibilityError(caught instanceof AccountError ? caught.message : "خطایی رخ داد.");
    } finally {
      setIsSavingVisibility(false);
    }
  };

  return (
    <AppPage title="حساب من" width="narrow">
      <ProfileView
        profile={profile}
        isOwner
        favoritesHref="/saved"
        favoritesLimit={OWNER_FAVORITES_SHOWN}
        heroActions={
          <div className="account-hero-actions">
            <Link
              href="/profile/settings"
              className={buttonVariants({ variant: "outline", size: "sm", className: "account-pill" })}
            >
              <FaCog aria-hidden="true" />
              تنظیمات
            </Link>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="account-pill"
              onClick={async () => {
                await logOut().catch(() => undefined);
                window.location.assign("/");
              }}
            >
              <FaSignOutAlt aria-hidden="true" />
              خروج
            </Button>
          </div>
        }
      >
        <Card className="profile-public">
          <div className="profile-public-row">
            <div className="profile-public-text">
              <strong id="profile-public-label">نمایهٔ عمومی</strong>
              <span>
                {user.isPublic
                  ? "هر کس پیوند را داشته باشد، شعر در حال خواندن، آخرین شعر و پسندیده‌هایتان را می‌بیند."
                  : "خاموش است؛ نمایهٔ شما برای دیگران پیدا نمی‌شود."}
              </span>
            </div>
            <Switch
              checked={user.isPublic}
              disabled={isSavingVisibility}
              onCheckedChange={handleVisibility}
              aria-labelledby="profile-public-label"
            />
          </div>
          {visibilityError && <FormError>{visibilityError}</FormError>}
          {user.isPublic && (
            <div className="profile-public-row">
              <Link href={profilePath} className="profile-public-link" dir="ltr">
                ganjoorak.ir{profilePath}
              </Link>
              <ShareProfileButton profile={user} />
            </div>
          )}
        </Card>
      </ProfileView>
    </AppPage>
  );
};

/** /@username, rendered on the server for visitors and link previews. */
export const PublicProfilePage = ({ profile }: { profile: PublicProfile }) => {
  const [isOwner, setIsOwner] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  // The server rendered the count; a follow made here moves it without a reload.
  const [followerCount, setFollowerCount] = useState(profile.followerCount);

  useEffect(() => {
    fetchAccount()
      .then(({ user }) => {
        setSignedIn(true);
        setIsOwner(user.username === profile.username);
      })
      .catch(() => undefined);
  }, [profile.username]);

  return (
    <AppPage
      title={profile.displayName}
      width="narrow"
      actions={
        isOwner && (
          <Link href="/profile" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            حساب من
          </Link>
        )
      }
    >
      <ProfileView
        profile={{ ...profile, followerCount }}
        isOwner={false}
        heroActions={
          <div className="account-hero-actions">
            {!isOwner && (
              <FollowUserButton
                username={profile.username}
                displayName={profile.displayName}
                signedIn={signedIn}
                onChange={(following) => setFollowerCount((count) => count + (following ? 1 : -1))}
              />
            )}
            <ShareProfileButton profile={profile} />
          </div>
        }
      />
    </AppPage>
  );
};
