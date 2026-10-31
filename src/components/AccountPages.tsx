"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FaArrowRight,
  FaCog,
  FaChevronLeft,
  FaEye,
  FaEyeSlash,
  FaGlobe,
  FaHistory,
  FaSignOutAlt,
} from "react-icons/fa";
import AppPage from "@/components/AppPage";
import AuthFeatureSlides from "@/components/AuthFeatureSlides";
import { BadgeGrid } from "@/components/profile/BadgeGrid";
import ProfileHeader, { ShareProfileButton } from "@/components/profile/ProfileHeader";
import { QuotesPanel } from "@/components/profile/QuotesPanel";
import { StreakCard, StreakChip } from "@/components/profile/StreakCard";
import ProfileAvatar from "@/components/ProfileAvatar";
import RecoveryCodePanel from "@/components/RecoveryCodePanel";
import { CollectionList, PoemLibraryList, useLibraryVersion } from "@/components/PoemLibraryPage";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogPopup, DialogTitle } from "@/components/ui/dialog";
import FollowUserButton from "@/components/FollowUserButton";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { FormError } from "@/components/ui/form-error";
import { Input } from "@/components/ui/input";
import { FieldHint, Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
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
import { getSinglePoemHref, readFavorites, readHistory, type PoemLibraryEntry } from "@/utils/poemLibrary";
import { profileThemeStyle } from "@/utils/profileTheme";
import { fetchCatalog, type Badge, type Streak } from "@/utils/progressApi";
import "../styles/PoemLibrary.css";
import "../styles/ProfileHeader.css";

type AuthMode = "login" | "signup";

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

export const LoginPage = () => {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // "reset" is forgot-password: username + recovery code + new password.
  const [view, setView] = useState<"auth" | "reset">("auth");
  const [recoveryInput, setRecoveryInput] = useState("");
  // A code the service just issued (sign-up or reset), shown once before continuing.
  const [issuedCode, setIssuedCode] = useState("");
  // Below the desktop layout the page is a welcome screen and the form opens as a sheet.
  const [isSheetOpen, setIsSheetOpen] = useState(false);

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
      if (view === "reset") {
        const { recoveryCode } = await resetPassword(username, recoveryInput, password);
        setIssuedCode(recoveryCode);
        setIsSubmitting(false);
        return;
      }
      if (mode === "signup") {
        // An empty display name falls back to the username; it can be set later on the profile.
        const { recoveryCode } = await signUp(username, password, "");
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

  const showAuth = (nextMode: AuthMode) => {
    setMode(nextMode);
    setView("auth");
    setError("");
  };

  const openSheet = (nextMode: AuthMode) => {
    showAuth(nextMode);
    setIsSheetOpen(true);
  };

  const isSignup = mode === "signup";
  const isReset = view === "reset";
  const title = issuedCode
    ? "کد بازیابی شما"
    : isReset
      ? "بازیابی گذرواژه"
      : isSignup
        ? "ساخت حساب"
        : "ورود به حساب";
  const description = isReset && !issuedCode
    ? "نام کاربری و کد بازیابی‌ای را که هنگام ساخت حساب گرفتید وارد کنید و گذرواژهٔ تازه بگذارید."
    : null;

  const form = issuedCode ? (
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
        {isSignup && <FieldHint>حروف لاتین، رقم یا _ (۳ تا ۳۲ نویسه)</FieldHint>}
      </Label>

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
        {isSignup && <FieldHint>دست‌کم ۸ نویسه</FieldHint>}
      </Label>

      {!isSignup && (
        <button
          type="button"
          className="auth-text-button"
          onClick={() => {
            setView("reset");
            setError("");
            setPassword("");
          }}
        >
          گذرواژه را فراموش کرده‌اید؟
        </button>
      )}

      {error && <FormError>{error}</FormError>}

      <Button type="submit" size="lg" className="auth-submit" loading={isSubmitting}>
        {isSignup ? "ساخت حساب" : "ورود"}
      </Button>

      <p className="auth-switch">
        {isSignup ? "حساب دارید؟" : "حساب ندارید؟"}
        <button
          type="button"
          className="auth-text-button"
          onClick={() => showAuth(isSignup ? "login" : "signup")}
        >
          {isSignup ? "ورود" : "ساخت حساب"}
        </button>
      </p>
    </form>
  );

  return (
    <div className="auth-page" dir="rtl">
      <Button
        variant="ghost"
        size="icon-lg"
        className="auth-back"
        onClick={handleBack}
        aria-label="بازگشت"
      >
        <FaArrowRight />
      </Button>

      <main className="auth-main">
        {/* The sheet holds the only copy of the form while it is open. */}
        {!isSheetOpen && (
          <div className="auth-main-inner">
            <header className="auth-header">
              <h1>{title}</h1>
              {description && <p>{description}</p>}
            </header>
            <Card className="auth-card">{form}</Card>
          </div>
        )}
      </main>

      <aside className="auth-hero">
        <AuthFeatureSlides />
        <div className="auth-hero-brand">
          <span className="auth-hero-logo">گنجورک</span>
          <p className="auth-hero-tagline">راحت‌تر شعر بخوانیم و شعر گوش دهیم.</p>
          <span className="auth-hero-domain" dir="ltr">ganjoorak.ir</span>
        </div>
        <div className="auth-welcome-actions">
          <Button size="lg" className="auth-submit" onClick={() => openSheet("signup")}>
            ساخت حساب
          </Button>
          <Button size="lg" variant="ghost" className="auth-submit" onClick={() => openSheet("login")}>
            ورود
          </Button>
        </div>
      </aside>

      <Dialog
        open={isSheetOpen}
        onOpenChange={(open) => {
          // The recovery code is shown only once: this sheet must not be dismissed by accident.
          if (!open && (issuedCode || isSubmitting)) return;
          setIsSheetOpen(open);
        }}
      >
        <DialogPopup dir="rtl" showCloseButton={!issuedCode}>
          <div className="auth-sheet">
            <header className="auth-header">
              <DialogTitle className="auth-sheet-title">{title}</DialogTitle>
              {description && <p>{description}</p>}
            </header>
            {form}
          </div>
        </DialogPopup>
      </Dialog>
    </div>
  );
};

const persianNumber = new Intl.NumberFormat("fa-IR");

// Mirrors readingWindow in backend/account.go, for the owner's own preview.
const READING_WINDOW_MS = 20 * 60 * 1000;
const OWNER_FAVORITES_SHOWN = 5;

/** What the profile body needs; the owner's page builds it from the account and this device's lists. */
type ProfileSummary = Omit<
  PublicProfile,
  "favoriteCount" | "followerCount" | "followingCount" | "streak" | "badges" | "quotes" | "quoteCount"
> & {
  favoriteCount?: number;
  followerCount?: number;
  followingCount?: number;
};

type ProfileTab = "quotes" | "favorites" | "books" | "badges";

const PROFILE_TABS: { id: ProfileTab; label: string }[] = [
  { id: "quotes", label: "تکه‌ها" },
  { id: "favorites", label: "پسندها" },
  { id: "books", label: "کتاب‌ها" },
  { id: "badges", label: "نشان‌ها" },
];

const ProfilePoem = ({ entry, live }: { entry: PoemLibraryEntry; live?: boolean }) => (
  <Link
    href={getSinglePoemHref(entry.href)}
    prefetch={false}
    className={`app-row profile-poem${live ? " profile-poem--live" : ""}`}
  >
    <span className="app-row-icon" aria-hidden="true">
      {live ? <span className="profile-live-dot" /> : <FaHistory />}
    </span>
    <span className="app-row-body">
      <span className="app-row-title">{entry.title}</span>
      {entry.excerpt && <span className="library-excerpt">{entry.excerpt}</span>}
      <span className="app-row-meta">{live ? "در حال خواندن · " : "آخرین شعر · "}{entry.poetName}</span>
    </span>
    <FaChevronLeft className="app-row-chevron" aria-hidden="true" />
  </Link>
);

/**
 * The profile body shared by the owner's /profile and the public /@username:
 * header (banner, name, bio, buttons), streak, the poem being read / the last
 * one, then tabs for quotes, liked poems, loved books and badges. Preferred
 * poets and the full history stay private.
 */
const ProfileView = ({
  profile,
  isOwner,
  actions,
  streak,
  notice,
  quotes,
  badges,
  defaultTab = "quotes",
  favoritesHref,
  favoritesLimit,
  footer,
}: {
  profile: ProfileSummary;
  isOwner: boolean;
  /** Primary buttons under the header. */
  actions?: ReactNode;
  /** Streak card (owner) or chip (visitors). */
  streak?: ReactNode;
  /** Shown above the tabs, e.g. "your profile is private". */
  notice?: ReactNode;
  quotes: ReactNode;
  badges: ReactNode;
  defaultTab?: ProfileTab;
  /** Link to the full list when only part of it is shown. */
  favoritesHref?: string;
  favoritesLimit?: number;
  footer?: ReactNode;
}) => {
  const favorites = favoritesLimit ? profile.favorites.slice(0, favoritesLimit) : profile.favorites;
  const favoriteCount = profile.favoriteCount ?? profile.favorites.length;
  const hiddenFavorites = favoriteCount - favorites.length;
  const poem = profile.nowReading ?? profile.lastPoem;

  return (
    <>
      <ProfileHeader profile={profile} isOwner={isOwner}>
        {actions}
      </ProfileHeader>

      {streak}

      {poem && (
        <section className="profile-now" aria-label={profile.nowReading ? "در حال خواندن" : "آخرین شعر"}>
          <div className="app-list">
            <ProfilePoem entry={poem} live={Boolean(profile.nowReading)} />
          </div>
        </section>
      )}

      {notice}

      <Tabs defaultValue={defaultTab} className="profile-tabs">
        <TabsList aria-label="بخش‌های نمایه" className="relative">
          <TabsIndicator />
          {PROFILE_TABS.map((tab) => (
            <TabsTab
              key={tab.id}
              value={tab.id}
              className="relative data-active:bg-transparent data-active:shadow-none"
            >
              {tab.label}
            </TabsTab>
          ))}
        </TabsList>

        <TabsPanel value="quotes" keepMounted className="library-panel">
          {quotes}
        </TabsPanel>

        <TabsPanel value="favorites" className="library-panel">
          <PoemLibraryList
            entries={favorites}
            icon="heart"
            emptyMessage={
              isOwner
                ? "هنوز شعری نپسندیده‌اید. روی آیکن قلب در صفحهٔ شعر بزنید."
                : "هنوز شعری نپسندیده است."
            }
          />
          {favoritesHref && hiddenFavorites > 0 && (
            <p className="profile-more">
              <Link href={favoritesHref} className="account-section-link">
                همهٔ {persianNumber.format(favoriteCount)} شعر
                <FaChevronLeft aria-hidden="true" />
              </Link>
            </p>
          )}
          {!favoritesHref && hiddenFavorites > 0 && (
            <p className="profile-more">و {persianNumber.format(hiddenFavorites)} شعر دیگر</p>
          )}
        </TabsPanel>

        <TabsPanel value="books" className="library-panel">
          <CollectionList
            entries={profile.lovedCollections}
            emptyMessage={
              isOwner
                ? "هنوز کتابی را دوست نداشته‌اید. در صفحهٔ هر شاعر روی قلبِ کنار مجموعه بزنید."
                : "هنوز کتابی را دوست نداشته است."
            }
          />
        </TabsPanel>

        <TabsPanel value="badges" className="library-panel">
          {badges}
        </TabsPanel>
      </Tabs>

      {footer}
    </>
  );
};

const errorText = (caught: unknown) => (caught instanceof AccountError ? caught.message : "خطایی رخ داد.");

export const ProfilePage = () => {
  const router = useRouter();
  const [user, setUser] = useState<AccountUser | null>(null);
  const [follows, setFollows] = useState<FollowCounts | null>(null);
  const [progress, setProgress] = useState<{ streak: Streak; badges: Badge[] } | null>(null);
  const [catalog, setCatalog] = useState<Badge[]>([]);
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
      .then(({ user: account, follows: counts, progress: earned }) => {
        setOpenedAt(Date.now());
        setUser(account);
        setFollows(counts);
        setProgress(earned ?? null);
      })
      .catch((caught) => {
        if (caught instanceof AccountError && caught.status === 401) {
          router.replace("/login");
        } else {
          setError(errorText(caught));
        }
      });
    // The locked badges are only a nicety; the page works without the catalog.
    fetchCatalog()
      .then((body) => setCatalog(body.badges))
      .catch(() => undefined);
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
  const themeStyle = profileThemeStyle(user.accent, user.background);
  const earnedKeys = new Set((progress?.badges ?? []).map((badge) => badge.key));
  const lockedBadges = catalog.filter((badge) => !earnedKeys.has(badge.key));

  const handleVisibility = async (isPublic: boolean) => {
    setVisibilityError("");
    setIsSavingVisibility(true);
    try {
      const { user: account } = await setProfileVisibility(isPublic);
      setUser(account);
    } catch (caught) {
      setVisibilityError(errorText(caught));
    } finally {
      setIsSavingVisibility(false);
    }
  };

  const visibilityCard = (
    <>
      <ul className="app-list">
        <li>
          <div className="app-row">
            <span className="app-row-icon" aria-hidden="true">
              <FaGlobe />
            </span>
            <span className="app-row-body">
              <span id="profile-public-label" className="app-row-title">
                نمایهٔ عمومی
              </span>
              <span className="app-row-meta">
                {user.isPublic
                  ? "هر کس پیوند را داشته باشد، تکه‌ها، پسندها، نشان‌ها و شعر در حال خواندنتان را می‌بیند."
                  : "خاموش است؛ نمایهٔ شما برای دیگران پیدا نمی‌شود و پیوند اشتراک کار نمی‌کند."}
              </span>
            </span>
            <Switch
              checked={user.isPublic}
              disabled={isSavingVisibility}
              onCheckedChange={handleVisibility}
              aria-labelledby="profile-public-label"
            />
          </div>
        </li>
        {user.isPublic && (
          <li>
            <Link href={profilePath} className="app-row">
              <span className="app-row-body">
                <span className="app-row-title" dir="ltr">
                  ganjoorak.ir{profilePath}
                </span>
              </span>
              <FaChevronLeft className="app-row-chevron" aria-hidden="true" />
            </Link>
          </li>
        )}
      </ul>
      {visibilityError && <FormError>{visibilityError}</FormError>}
    </>
  );

  return (
    <AppPage
      title={user.displayName}
      width="narrow"
      hideHeader
      style={themeStyle}
      actions={
        <>
          <Link
            href="/profile/settings"
            className={buttonVariants({ variant: "ghost", size: "icon-lg", className: "app-page-bar-icon" })}
            aria-label="تنظیمات"
          >
            <FaCog aria-hidden="true" />
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className="app-page-bar-icon"
            aria-label="خروج"
            onClick={async () => {
              await logOut().catch(() => undefined);
              window.location.assign("/");
            }}
          >
            <FaSignOutAlt aria-hidden="true" />
          </Button>
        </>
      }
    >
      <ProfileView
        profile={profile}
        isOwner
        favoritesHref="/saved"
        favoritesLimit={OWNER_FAVORITES_SHOWN}
        actions={user.isPublic ? <ShareProfileButton profile={user} /> : undefined}
        streak={progress && <StreakCard streak={progress.streak} />}
        notice={!user.isPublic ? <section className="profile-notice">{visibilityCard}</section> : undefined}
        quotes={<QuotesPanel username={user.username} isOwner />}
        badges={
          progress?.badges.length || lockedBadges.length ? (
            <BadgeGrid earned={progress?.badges ?? []} locked={lockedBadges} />
          ) : (
            <Empty>
              <EmptyDescription>هنوز نشانی نگرفته‌اید. هر روز یک شعر بخوانید تا رشته شروع شود.</EmptyDescription>
            </Empty>
          )
        }
        footer={user.isPublic ? <section className="profile-footer">{visibilityCard}</section> : undefined}
      />
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

  const themeStyle = profileThemeStyle(profile.accent, profile.background);
  const lastQuote = profile.quotes[profile.quotes.length - 1];
  const firstPage = {
    quotes: profile.quotes,
    next: lastQuote && profile.quotes.length < profile.quoteCount ? lastQuote.id : null,
  };
  // Open on the first tab that has something in it.
  const defaultTab: ProfileTab =
    profile.quoteCount > 0 || profile.favoriteCount === 0
      ? "quotes"
      : "favorites";

  return (
    <AppPage
      title={profile.displayName}
      width="narrow"
      hideHeader
      style={themeStyle}
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
        defaultTab={defaultTab}
        actions={
          <>
            <ShareProfileButton profile={profile} />
            {!isOwner && (
              <FollowUserButton
                username={profile.username}
                displayName={profile.displayName}
                signedIn={signedIn}
                onChange={(following) => setFollowerCount((count) => count + (following ? 1 : -1))}
              />
            )}
          </>
        }
        streak={<StreakChip streak={profile.streak} />}
        quotes={<QuotesPanel username={profile.username} isOwner={false} initial={firstPage} />}
        badges={
          profile.badges.length > 0 ? (
            <BadgeGrid earned={profile.badges} />
          ) : (
            <Empty>
              <EmptyDescription>هنوز نشانی نگرفته است.</EmptyDescription>
            </Empty>
          )
        }
      />
    </AppPage>
  );
};
