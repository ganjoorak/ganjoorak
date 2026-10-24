"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import AppPage from "@/components/AppPage";
import { PasswordField } from "@/components/AccountPages";
import ProfileAvatar, { AVATAR_MOTIFS, resolveAvatar, type AvatarKey } from "@/components/ProfileAvatar";
import RecoveryCodePanel from "@/components/RecoveryCodePanel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { FormError } from "@/components/ui/form-error";
import { Input } from "@/components/ui/input";
import { FieldHint, Label } from "@/components/ui/label";
import {
  AccountError,
  changePassword,
  createRecoveryCode,
  fetchAccount,
  updateProfile,
  type AccountUser,
} from "@/utils/accountApi";
import "../styles/PoemLibrary.css";

const errorMessage = (caught: unknown) => (caught instanceof AccountError ? caught.message : "خطایی رخ داد.");

/** One settings card that submits on its own, with its own error and success line. */
const SettingsSection = ({
  id,
  title,
  description,
  onSubmit,
  error,
  done,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  onSubmit?: (event: FormEvent) => void;
  error: string;
  done: string;
  children: React.ReactNode;
}) => (
  <section className="app-section" aria-labelledby={id}>
    <h2 id={id} className="app-section-title">
      <span>{title}</span>
    </h2>
    <Card className="settings-card">
      {description && <p className="settings-description">{description}</p>}
      <form className="account-form" onSubmit={onSubmit}>
        {children}
        {error && <FormError>{error}</FormError>}
        {done && (
          <p className="settings-done" role="status">
            {done}
          </p>
        )}
      </form>
    </Card>
  </section>
);

const AvatarPicker = ({
  username,
  value,
  onChange,
}: {
  username: string;
  value: AvatarKey | "";
  onChange: (value: AvatarKey | "") => void;
}) => {
  const options: { key: AvatarKey | ""; label: string }[] = [
    { key: "", label: `خودکار (${resolveAvatar(username).name})` },
    ...AVATAR_MOTIFS.map((motif) => ({ key: motif.key, label: motif.name })),
  ];
  return (
    <div className="avatar-picker" role="radiogroup" aria-label="تصویر نمایه">
      {options.map((option) => (
        <button
          key={option.key || "auto"}
          type="button"
          role="radio"
          aria-checked={value === option.key}
          className="avatar-picker-option"
          onClick={() => onChange(option.key)}
        >
          <ProfileAvatar username={username} avatar={option.key || undefined} />
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
};

/** /profile/settings: picture, name and username, password, recovery code. */
export default function AccountSettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<AccountUser | null>(null);
  const [loadError, setLoadError] = useState("");

  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [avatar, setAvatar] = useState<AvatarKey | "">("");
  const [profileState, setProfileState] = useState({ busy: false, error: "", done: "" });

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordState, setPasswordState] = useState({ busy: false, error: "", done: "" });

  const [codePassword, setCodePassword] = useState("");
  const [issuedCode, setIssuedCode] = useState("");
  const [codeState, setCodeState] = useState({ busy: false, error: "", done: "" });

  useEffect(() => {
    fetchAccount()
      .then(({ user: account }) => {
        setUser(account);
        setDisplayName(account.displayName);
        setUsername(account.username);
        setAvatar(account.avatar);
      })
      .catch((caught) => {
        if (caught instanceof AccountError && caught.status === 401) {
          router.replace("/login");
        } else {
          setLoadError(errorMessage(caught));
        }
      });
  }, [router]);

  if (!user) {
    return (
      <AppPage title="تنظیمات حساب" width="narrow" backHref="/profile">
        <Empty role={loadError ? "alert" : "status"}>
          <EmptyDescription>{loadError || "در حال بارگذاری حساب…"}</EmptyDescription>
        </Empty>
      </AppPage>
    );
  }

  const handleProfile = async (event: FormEvent) => {
    event.preventDefault();
    setProfileState({ busy: true, error: "", done: "" });
    try {
      const { user: account } = await updateProfile({ username, displayName, avatar });
      setUser(account);
      setUsername(account.username);
      setDisplayName(account.displayName);
      setProfileState({ busy: false, error: "", done: "ذخیره شد." });
    } catch (caught) {
      setProfileState({ busy: false, error: errorMessage(caught), done: "" });
    }
  };

  const handlePassword = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordState({ busy: true, error: "", done: "" });
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setPasswordState({
        busy: false,
        error: "",
        done: "گذرواژه عوض شد. از دستگاه‌های دیگر خارج شدید.",
      });
    } catch (caught) {
      setPasswordState({ busy: false, error: errorMessage(caught), done: "" });
    }
  };

  const handleRecoveryCode = async (event: FormEvent) => {
    event.preventDefault();
    setCodeState({ busy: true, error: "", done: "" });
    try {
      const { user: account, recoveryCode } = await createRecoveryCode(codePassword);
      setUser(account);
      setCodePassword("");
      setIssuedCode(recoveryCode);
      setCodeState({ busy: false, error: "", done: "" });
    } catch (caught) {
      setCodeState({ busy: false, error: errorMessage(caught), done: "" });
    }
  };

  return (
    <AppPage title="تنظیمات حساب" width="narrow" backHref="/profile">
      <SettingsSection
        id="settings-profile"
        title="نمایه"
        onSubmit={handleProfile}
        error={profileState.error}
        done={profileState.done}
      >
        <AvatarPicker username={username || user.username} value={avatar} onChange={setAvatar} />
        <Label className="flex flex-col">
          <span>نام نمایشی</span>
          <Input
            name="displayName"
            autoComplete="nickname"
            maxLength={50}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </Label>
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
            onChange={(event) => setUsername(event.target.value)}
          />
          <FieldHint>
            نشانی نمایهٔ عمومی هم با آن عوض می‌شود: <span dir="ltr">ganjoorak.ir/@{username.toLowerCase() || "…"}</span>
          </FieldHint>
        </Label>
        <Button type="submit" className="settings-submit" loading={profileState.busy}>
          ذخیره
        </Button>
      </SettingsSection>

      <SettingsSection
        id="settings-password"
        title="گذرواژه"
        onSubmit={handlePassword}
        error={passwordState.error}
        done={passwordState.done}
      >
        <Label className="flex flex-col">
          <span>گذرواژهٔ فعلی</span>
          <PasswordField
            name="currentPassword"
            value={currentPassword}
            onChange={setCurrentPassword}
            autoComplete="current-password"
          />
        </Label>
        <Label className="flex flex-col">
          <span>گذرواژهٔ تازه</span>
          <PasswordField
            name="newPassword"
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
            minLength={8}
          />
          <FieldHint>دست‌کم ۸ نویسه</FieldHint>
        </Label>
        <Button type="submit" className="settings-submit" loading={passwordState.busy}>
          تغییر گذرواژه
        </Button>
      </SettingsSection>

      <SettingsSection
        id="settings-recovery"
        title="کد بازیابی"
        description={
          user.hasRecoveryCode
            ? "اگر گذرواژه را فراموش کنید، با کد بازیابی گذرواژهٔ تازه می‌گذارید. اگر کد را گم کرده‌اید، یک کد تازه بسازید؛ کد قبلی دیگر کار نمی‌کند."
            : "هنوز کد بازیابی ندارید. بدون آن، اگر گذرواژه را فراموش کنید راهی برای برگشت به حساب نیست."
        }
        onSubmit={issuedCode ? undefined : handleRecoveryCode}
        error={codeState.error}
        done={codeState.done}
      >
        {issuedCode ? (
          <RecoveryCodePanel
            code={issuedCode}
            doneLabel="بستن"
            onDone={() => {
              setIssuedCode("");
              setCodeState({ busy: false, error: "", done: "کد تازه ثبت شد." });
            }}
          />
        ) : (
          <>
            <Label className="flex flex-col">
              <span>گذرواژه</span>
              <PasswordField
                name="recoveryPassword"
                value={codePassword}
                onChange={setCodePassword}
                autoComplete="current-password"
              />
            </Label>
            <Button type="submit" className="settings-submit" loading={codeState.busy}>
              {user.hasRecoveryCode ? "ساخت کد تازه" : "ساخت کد بازیابی"}
            </Button>
          </>
        )}
      </SettingsSection>
    </AppPage>
  );
}
