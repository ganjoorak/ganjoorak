"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { FaBan, FaTimes } from "react-icons/fa";
import { ImagePlus } from "lucide-react";
import ProfileAvatar, { type AvatarValue } from "@/components/ProfileAvatar";
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
import AvatarPicker from "@/components/profile/AvatarPicker";
import ImageCropper, { type CropKind } from "@/components/profile/ImageCropper";
import { FALLBACK_BANNERS, bannerBackground } from "@/components/profile/profileFormat";
import { AccountError, updateAppearance, updateProfile, type AccountUser } from "@/utils/accountApi";
import { setAccountSessionUser } from "@/utils/accountSession";
import { LOW_CONTRAST_MESSAGE, hasEnoughContrast, isHexColor } from "@/utils/colorContrast";
import {
  isUploadedImage,
  removeAvatar,
  removeBanner,
  uploadAvatar,
  uploadBanner,
} from "@/utils/mediaApi";
import { profileThemeStyle } from "@/utils/profileTheme";
import { fetchCatalog, type Banner, type BannerValue } from "@/utils/progressApi";
import { formatPersianNumber } from "@/utils/searchText";
import "@/styles/SettingsSheet.css";
import "../../styles/AppearanceSheet.css";

const BIO_MAX = 160;

// Anything image-like may be picked; the crop step re-encodes it as JPEG, so WebP (and whatever the
// browser can decode) works too. Just keep the browser from decoding something enormous.
const MAX_PICKED_BYTES = 25 * 1024 * 1024;

/** Where the last upload / removal ended up, shown under the matching section. */
interface UploadState {
  kind: CropKind | null;
  busy: boolean;
  error: string;
  done: string;
}
const IDLE_UPLOAD: UploadState = { kind: null, busy: false, error: "", done: "" };

const errorText = (caught: unknown) => (caught instanceof AccountError ? caught.message : "خطایی رخ داد.");

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
  const [banner, setBanner] = useState<BannerValue>(user.banner);
  const [avatar, setAvatar] = useState<AvatarValue>(user.avatar);
  const [crop, setCrop] = useState<{ file: File; kind: CropKind } | null>(null);
  const [upload, setUpload] = useState<UploadState>(IDLE_UPLOAD);
  const fileInput = useRef<HTMLInputElement>(null);
  const pickKind = useRef<CropKind>("banner");
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

  const pickImage = (kind: CropKind) => {
    pickKind.current = kind;
    fileInput.current?.click();
  };

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // So picking the same file again still fires onChange.
    event.target.value = "";
    if (!file) {
      return;
    }
    const kind = pickKind.current;
    if (!file.type.startsWith("image/")) {
      setUpload({ ...IDLE_UPLOAD, kind, error: "فقط تصویر JPEG یا PNG." });
    } else if (file.size > MAX_PICKED_BYTES) {
      setUpload({ ...IDLE_UPLOAD, kind, error: "تصویر خیلی بزرگ است." });
    } else {
      setUpload({ ...IDLE_UPLOAD, kind });
      setCrop({ file, kind });
    }
  };

  /** Uploads apply at once (their own endpoints); the colours and bio below still wait for «ذخیره». */
  const applyUploaded = (saved: AccountUser, kind: CropKind, done: string) => {
    if (kind === "avatar") {
      setAvatar(saved.avatar);
    } else {
      setBanner(saved.banner);
    }
    onSaved(saved);
    setAccountSessionUser(saved);
    setUpload({ kind, busy: false, error: "", done });
  };

  const handleCropped = async (blob: Blob) => {
    if (!crop) {
      return;
    }
    const { kind } = crop;
    setUpload({ kind, busy: true, error: "", done: "" });
    try {
      const saved = kind === "avatar" ? await uploadAvatar(blob) : await uploadBanner(blob);
      applyUploaded(saved, kind, kind === "avatar" ? "تصویر نمایه ذخیره شد." : "بنر ذخیره شد.");
      setCrop(null);
    } catch (caught) {
      setUpload({ kind, busy: false, error: errorText(caught), done: "" });
    }
  };

  const handleRemove = async (kind: CropKind) => {
    setUpload({ kind, busy: true, error: "", done: "" });
    try {
      const saved = kind === "avatar" ? await removeAvatar() : await removeBanner();
      // A different choice made but not yet saved stays; only a selected upload falls back to «none».
      const keep = kind === "avatar" ? !isUploadedImage(avatar) : !isUploadedImage(banner);
      if (keep) {
        onSaved(saved);
        setAccountSessionUser(saved);
        setUpload({ kind, busy: false, error: "", done: "تصویر حذف شد." });
      } else {
        applyUploaded(saved, kind, "تصویر حذف شد.");
      }
    } catch (caught) {
      setUpload({ kind, busy: false, error: errorText(caught), done: "" });
    }
  };

  const handleSave = async () => {
    if (lowContrast || upload.busy) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      // The picture is part of the profile, not the appearance, endpoint; only sent when it changed.
      if (avatar !== user.avatar) {
        const { user: renamed } = await updateProfile({
          username: user.username,
          displayName: user.displayName,
          avatar,
        });
        onSaved(renamed);
        setAccountSessionUser(renamed);
      }
      const { user: saved } = await updateAppearance({ bio: bio.trim(), banner, accent, background });
      onSaved(saved);
      setAccountSessionUser(saved);
      onClose();
    } catch (caught) {
      setError(caught instanceof AccountError ? caught.message : "خطایی رخ داد.");
      setBusy(false);
    }
  };

  if (crop) {
    return (
      <ImageCropper
        file={crop.file}
        kind={crop.kind}
        busy={upload.busy}
        error={upload.error}
        onBack={() => {
          setCrop(null);
          setUpload(IDLE_UPLOAD);
        }}
        onConfirm={handleCropped}
      />
    );
  }

  const storedBanner = isUploadedImage(user.banner) ? user.banner : null;
  const storedAvatar = isUploadedImage(user.avatar) ? user.avatar : null;
  const status = (kind: CropKind) =>
    upload.kind === kind && (
      <>
        {upload.error && <FormError>{upload.error}</FormError>}
        {upload.done && (
          <p className="appearance-upload-status" role="status">
            {upload.done}
          </p>
        )}
      </>
    );

  return (
    <>
      <DialogHeader className="settings-sheet-header">
        <DialogTitle>ویرایش ظاهر</DialogTitle>
        <Button variant="ghost" size="icon-lg" onClick={onClose} aria-label="بستن">
          <FaTimes aria-hidden="true" />
        </Button>
      </DialogHeader>
      <DialogPanel className="settings-sheet-body">
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={handleFile}
        />
        <div aria-live="polite" className="settings-sheet-groups">
          <section className="settings-group">
            <h3 className="settings-group-title">پیش‌نمایش</h3>
            <div className="settings-group-card">
              <div className="appearance-preview" style={previewStyle} aria-label="پیش‌نمایش" role="img">
                <div
                  className="appearance-preview-banner"
                  style={bannerBackground(banner)}
                />
                <div className="appearance-preview-body">
                  <ProfileAvatar
                    username={user.username}
                    avatar={avatar}
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
                  <button
                    type="button"
                    className="appearance-banner appearance-banner--upload"
                    disabled={upload.busy}
                    onClick={() => pickImage("banner")}
                  >
                    <ImagePlus aria-hidden="true" />
                    <span>بارگذاری تصویر</span>
                  </button>
                  {storedBanner && (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={banner === storedBanner}
                      aria-label="تصویر شما"
                      className="appearance-banner"
                      style={bannerBackground(storedBanner)}
                      onClick={() => setBanner(storedBanner)}
                    >
                      <span>تصویر شما</span>
                    </button>
                  )}
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
                <FieldHint>تصویر بنر همان لحظه ذخیره می‌شود؛ بقیهٔ تغییرات با دکمهٔ «ذخیره».</FieldHint>
                {storedBanner && (
                  <Button
                    type="button"
                    variant="outline"
                    className="appearance-remove"
                    loading={upload.busy && upload.kind === "banner"}
                    disabled={upload.busy}
                    onClick={() => handleRemove("banner")}
                  >
                    حذف تصویر
                  </Button>
                )}
                {status("banner")}
              </div>
            </div>
          </section>

          <section className="settings-group" aria-labelledby="appearance-avatar-title">
            <h3 id="appearance-avatar-title" className="settings-group-title">
              تصویر نمایه
            </h3>
            <div className="settings-group-card">
              <div className="settings-group-block">
                <AvatarPicker
                  username={user.username}
                  value={avatar}
                  onChange={setAvatar}
                  uploaded={user.avatar}
                  onUpload={() => pickImage("avatar")}
                  disabled={upload.busy}
                />
                <FieldHint>تصویر دلخواه همان لحظه ذخیره می‌شود؛ انتخاب یکی از طرح‌ها با دکمهٔ «ذخیره».</FieldHint>
                {storedAvatar && (
                  <Button
                    type="button"
                    variant="outline"
                    className="appearance-remove"
                    loading={upload.busy && upload.kind === "avatar"}
                    disabled={upload.busy}
                    onClick={() => handleRemove("avatar")}
                  >
                    حذف تصویر
                  </Button>
                )}
                {status("avatar")}
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
        <Button size="lg" onClick={handleSave} loading={busy} disabled={lowContrast || upload.busy}>
          ذخیره
        </Button>
      </DialogFooter>
    </>
  );
};

/**
 * «ویرایش ظاهر»: banner and profile picture (presets or an uploaded, cropped image), accent and
 * background colours and bio, with a live preview. Uploads apply at once; the rest waits for «ذخیره». A bottom sheet on phones (same shell as the settings sheet).
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
