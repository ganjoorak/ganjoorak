"use client";

import { useEffect, useState } from "react";
import { FaBan, FaTimes } from "react-icons/fa";
import ProfileAvatar from "@/components/ProfileAvatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-error";
import { Input } from "@/components/ui/input";
import { FieldHint } from "@/components/ui/label";
import { FALLBACK_BANNERS, bannerImage } from "@/components/profile/profileFormat";
import { AccountError, updateAppearance, type AccountUser } from "@/utils/accountApi";
import { LOW_CONTRAST_MESSAGE, hasEnoughContrast, isHexColor } from "@/utils/colorContrast";
import { profileThemeStyle } from "@/utils/profileTheme";
import { fetchCatalog, type Banner, type BannerKey } from "@/utils/progressApi";
import { formatPersianNumber } from "@/utils/searchText";
import "@/styles/SettingsSheet.css";
import "../../styles/AppearanceSheet.css";

const BIO_MAX = 160;

const ACCENT_PRESETS = ["#c2410c", "#b45309", "#15803d", "#0f766e", "#1d4ed8", "#6d28d9", "#be185d", "#dc2626"];
const BACKGROUND_PRESETS = ["#fffdf7", "#f6efe0", "#e6f2ee", "#e8eefb", "#1c1c24", "#10283f", "#2b1f3d", "#14261f"];

const ColorField = ({
  label,
  value,
  presets,
  onChange,
}: {
  label: string;
  value: string;
  presets: string[];
  onChange: (value: string) => void;
}) => {
  // What is typed in the box; only a complete #rrggbb (or nothing) reaches `value`.
  const [text, setText] = useState(value);

  useEffect(() => {
    setText(value);
  }, [value]);

  const handleText = (raw: string) => {
    const next = raw.trim().toLowerCase();
    setText(raw);
    const withHash = next && !next.startsWith("#") ? `#${next}` : next;
    if (withHash === "") {
      onChange("");
    } else if (isHexColor(withHash)) {
      onChange(withHash);
    }
  };

  return (
    <section className="settings-group" role="group" aria-label={label}>
      <h3 className="settings-group-title">{label}</h3>
      <div className="settings-group-card">
        <div className="settings-group-block">
          <div className="appearance-swatches">
            <button
              type="button"
              className="appearance-swatch"
              aria-pressed={value === ""}
              aria-label="پیش‌فرض برنامه"
              title="پیش‌فرض برنامه"
              onClick={() => onChange("")}
            >
              <FaBan aria-hidden="true" />
            </button>
            {presets.map((preset) => (
              <button
                key={preset}
                type="button"
                className="appearance-swatch"
                style={{ backgroundColor: preset }}
                aria-pressed={value === preset}
                aria-label={preset}
                onClick={() => onChange(preset)}
              />
            ))}
          </div>
        </div>
        <div className="settings-group-block appearance-color-row">
          <input
            type="color"
            className="h-11 w-12 shrink-0 cursor-pointer rounded-lg border border-input bg-background p-1 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20"
            aria-label={`${label}: انتخاب با پالت`}
            value={isHexColor(value) ? value : "#888888"}
            onChange={(event) => onChange(event.target.value.toLowerCase())}
          />
          <Input
            type="text"
            dir="ltr"
            className="font-mono"
            inputMode="text"
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            maxLength={7}
            placeholder="#rrggbb"
            aria-label={`${label}: کد رنگ`}
            value={text}
            onChange={(event) => handleText(event.target.value)}
          />
        </div>
      </div>
    </section>
  );
};

const AppearanceForm = ({
  user,
  onClose,
  onSaved,
}: {
  user: AccountUser;
  onClose: () => void;
  onSaved: (user: AccountUser) => void;
}) => {
  const [bio, setBio] = useState(user.bio);
  const [banner, setBanner] = useState<BannerKey | "">(user.banner);
  const [accent, setAccent] = useState(user.accent);
  const [background, setBackground] = useState(user.background);
  const [banners, setBanners] = useState<Banner[]>(FALLBACK_BANNERS);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchCatalog()
      .then((catalog) => !cancelled && catalog.banners.length > 0 && setBanners(catalog.banners))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const lowContrast = !hasEnoughContrast(accent, background);
  const previewStyle = profileThemeStyle(accent, background);

  const handleSave = async () => {
    if (lowContrast) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { user: saved } = await updateAppearance({ bio: bio.trim(), banner, accent, background });
      onSaved(saved);
      onClose();
    } catch (caught) {
      setError(caught instanceof AccountError ? caught.message : "خطایی رخ داد.");
      setBusy(false);
    }
  };

  return (
    <>
      <DialogHeader className="settings-sheet-header">
        <DialogTitle>ویرایش ظاهر</DialogTitle>
        <Button variant="ghost" size="icon-lg" onClick={onClose} aria-label="بستن">
          <FaTimes aria-hidden="true" />
        </Button>
      </DialogHeader>
      <DialogPanel className="settings-sheet-body">
        <div aria-live="polite" className="settings-sheet-groups">
          <section className="settings-group">
            <h3 className="settings-group-title">پیش‌نمایش</h3>
            <div className="settings-group-card">
              <div className="appearance-preview" style={previewStyle} aria-label="پیش‌نمایش" role="img">
                <div
                  className="appearance-preview-banner"
                  style={banner ? { backgroundImage: `url(${bannerImage(banner)})` } : undefined}
                />
                <div className="appearance-preview-body">
                  <ProfileAvatar
                    username={user.username}
                    avatar={user.avatar}
                    className="appearance-preview-avatar"
                    decorative
                  />
                  <strong>{user.displayName}</strong>
                  <span dir="ltr">@{user.username}</span>
                  {bio.trim() && <p>{bio.trim()}</p>}
                  <div className="appearance-preview-actions">
                    <span className="appearance-preview-button appearance-preview-button--outline">اشتراک‌گذاری</span>
                    <span className="appearance-preview-button">دنبال کردن</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="settings-group" role="radiogroup" aria-label="بنر">
            <h3 className="settings-group-title">بنر</h3>
            <div className="settings-group-card">
              <div className="settings-group-block">
                <div className="appearance-banners">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={banner === ""}
                    className="appearance-banner appearance-banner--none"
                    onClick={() => setBanner("")}
                  >
                    <span>بدون بنر</span>
                  </button>
                  {banners.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      role="radio"
                      aria-checked={banner === item.key}
                      aria-label={item.title}
                      className="appearance-banner"
                      style={{ backgroundImage: `url(${item.image})` }}
                      onClick={() => setBanner(item.key)}
                    >
                      <span>{item.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <ColorField label="رنگ تأکید" value={accent} presets={ACCENT_PRESETS} onChange={setAccent} />
          <ColorField label="رنگ پس‌زمینه" value={background} presets={BACKGROUND_PRESETS} onChange={setBackground} />

          {lowContrast && <FormError>{LOW_CONTRAST_MESSAGE}</FormError>}

          <section className="settings-group">
            <h3 className="settings-group-title">دربارهٔ من</h3>
            <div className="settings-group-card">
              <div className="settings-group-block">
                <textarea
                  className="w-full min-w-0 resize-none rounded-lg border border-input bg-background px-3 py-2 text-base leading-8 text-foreground shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 md:text-sm"
                  aria-label="دربارهٔ من"
                  rows={3}
                  maxLength={BIO_MAX}
                  placeholder="چند کلمه دربارهٔ خودتان…"
                  value={bio}
                  onChange={(event) => setBio(event.target.value.replace(/\s*\n\s*/g, " "))}
                />
                <FieldHint className={`justify-self-end ${bio.length >= BIO_MAX ? "text-destructive" : ""}`}>
                  {formatPersianNumber(bio.length)} / {formatPersianNumber(BIO_MAX)}
                </FieldHint>
              </div>
            </div>
          </section>

          {error && <FormError>{error}</FormError>}
        </div>
      </DialogPanel>
      <DialogFooter className="settings-sheet-footer">
        <Button variant="outline" size="lg" onClick={onClose} disabled={busy}>
          انصراف
        </Button>
        <Button size="lg" onClick={handleSave} loading={busy} disabled={lowContrast}>
          ذخیره
        </Button>
      </DialogFooter>
    </>
  );
};

/**
 * «ویرایش ظاهر»: banner, accent and background colours and bio, with a live
 * preview. A bottom sheet on phones (same shell as the settings sheet).
 */
export default function AppearanceSheet({
  open,
  onOpenChange,
  user,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: AccountUser;
  onSaved: (user: AccountUser) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The popup only mounts while open, so the form starts from the saved values each time. */}
      <DialogPopup dir="rtl" showCloseButton={false} className="settings-sheet appearance-sheet">
        <AppearanceForm user={user} onClose={() => onOpenChange(false)} onSaved={onSaved} />
      </DialogPopup>
    </Dialog>
  );
}
