"use client";

import { ImagePlus } from "lucide-react";
import ProfileAvatar, { AVATAR_MOTIFS, resolveAvatar, type AvatarValue } from "@/components/ProfileAvatar";
import { isUploadedImage, type UploadedImage } from "@/utils/mediaApi";
import "@/styles/PoemLibrary.css";

/**
 * The profile-picture choices: «خودکار», the poetry motifs, the picture the user already uploaded (if
 * any) and, when `onUpload` is given, a tile that starts an upload. Shared by /profile/settings and the
 * appearance sheet; picking only calls `onChange`, saving is the caller's business.
 */
export default function AvatarPicker({
  username,
  value,
  onChange,
  uploaded,
  onUpload,
  disabled = false,
}: {
  username: string;
  value: AvatarValue;
  onChange: (value: AvatarValue) => void;
  /** The upload currently stored for the account, so it stays selectable after picking a motif. */
  uploaded?: AvatarValue;
  onUpload?: () => void;
  disabled?: boolean;
}) {
  const stored: UploadedImage | null = isUploadedImage(uploaded) ? uploaded : null;
  const options: { key: AvatarValue; label: string }[] = [
    { key: "", label: `خودکار (${resolveAvatar(username).name})` },
    ...AVATAR_MOTIFS.map((motif) => ({ key: motif.key, label: motif.name })),
    ...(stored ? [{ key: stored, label: "تصویر شما" }] : []),
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
          disabled={disabled}
          onClick={() => onChange(option.key)}
        >
          <ProfileAvatar username={username} avatar={option.key || undefined} decorative />
          <span>{option.label}</span>
        </button>
      ))}
      {onUpload && (
        <button type="button" className="avatar-picker-option" disabled={disabled} onClick={onUpload}>
          <span className="avatar-picker-upload" aria-hidden="true">
            <ImagePlus />
          </span>
          <span>بارگذاری تصویر</span>
        </button>
      )}
    </div>
  );
}
