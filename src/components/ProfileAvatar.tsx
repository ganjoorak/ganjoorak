import { useState, type CSSProperties, type ReactNode } from "react";
import { mediaUrl, type UploadedImage } from "@/utils/mediaApi";

// Profile picture: a line motif from classical Persian poetry. Users can pick one in account settings;
// otherwise it is picked from the username so a person always gets the same one. Drawn with
// currentColor over theme tokens (see .profile-avatar). Keys match validAvatars in backend/account.go.

export const AVATAR_MOTIFS = [
  {
    key: "cypress",
    name: "سرو",
    paths: (
      <>
        <path d="M12 2.8c1.4 1 2 2.2 1.6 3.4 1.9 2.4 2.9 4.9 2.9 7.3 0 3.1-2 5.4-4.5 5.4s-4.5-2.3-4.5-5.4c0-3.6 2-7.4 4.5-10.7Z" />
        <path d="M12 9.5v9.4M12 12.5l1.8-1.6M12 15.4l-1.8-1.6M8.6 21.2h6.8" />
      </>
    ),
  },
  {
    key: "candle",
    name: "شمع",
    paths: (
      <>
        <path d="M12 2.9c1.6 1.9 2.3 3.3 2.3 4.5A2.3 2.3 0 0 1 12 9.7a2.3 2.3 0 0 1-2.3-2.3c0-1.2.7-2.6 2.3-4.5Z" />
        <path d="M12 9.7v1.4M9.6 11.1h4.8v8.9H9.6zM7.4 20.6h9.2" />
      </>
    ),
  },
  {
    key: "quill",
    name: "قلم",
    paths: (
      <>
        <path d="M20.4 3.6c-6 .2-10.6 3.9-11.9 9.6l-1.2 3.5 3.5-1.2c5.7-1.3 9.4-5.9 9.6-11.9Z" />
        <path d="M4 20.4l6.6-6.6M12.6 11.4l3.6-3.6" />
      </>
    ),
  },
  {
    key: "tulip",
    name: "لاله",
    paths: (
      <>
        <path d="M7.6 6.2c-.2 4.8 1.8 7.6 4.4 7.6s4.6-2.8 4.4-7.6l-2.2 2.1L12 5.2 9.8 8.3Z" />
        <path d="M12 13.8v7.4M12 18.6c-2.4-.1-3.9-1.4-4.4-3.4 2.2.1 3.7 1.2 4.4 3.4ZM12 20c.6-2.3 2.1-3.6 4.4-3.8-.4 2.2-2 3.5-4.4 3.8Z" />
      </>
    ),
  },
  {
    key: "cup",
    name: "جام",
    paths: (
      <>
        <path d="M6.9 4.2h10.2c0 4.6-2.3 7.6-5.1 7.6S6.9 8.8 6.9 4.2Z" />
        <path d="M7.5 6.8h9M12 11.8v6.4M8.6 20.2h6.8" />
      </>
    ),
  },
] as const satisfies readonly { key: string; name: string; paths: ReactNode }[];

export type AvatarKey = (typeof AVATAR_MOTIFS)[number]["key"];

/** What the service stores: a motif key, an uploaded picture ("img:<id>"), or "" for the username's motif. */
export type AvatarValue = AvatarKey | UploadedImage | "";

const hash = (value: string) => {
  let result = 0;
  for (const char of value) result = (result * 31 + char.codePointAt(0)!) >>> 0;
  return result;
};

/** The motif someone sees: their choice, else one picked from the username. */
export const resolveAvatar = (username: string, avatar?: string) =>
  AVATAR_MOTIFS.find((motif) => motif.key === avatar) ??
  AVATAR_MOTIFS[hash(username.toLowerCase()) % AVATAR_MOTIFS.length];

export default function ProfileAvatar({
  username,
  avatar,
  className,
  style,
  decorative = false,
}: {
  username: string;
  avatar?: string;
  className?: string;
  style?: CSSProperties;
  /** Hide from assistive tech when a name is already next to it. */
  decorative?: boolean;
}) {
  const motif = resolveAvatar(username, avatar);
  const photo = mediaUrl(avatar);
  // The motif stands in when the file fails to load; keyed by URL so a new upload gets its own try.
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const showPhoto = photo !== null && failedPhoto !== photo;
  const accessibility = decorative
    ? ({ "aria-hidden": true } as const)
    : ({ role: "img", "aria-label": showPhoto ? "تصویر نمایه" : `تصویر نمایه: ${motif.name}` } as const);
  return (
    <span
      className={["profile-avatar", showPhoto && "profile-avatar--photo", className].filter(Boolean).join(" ")}
      style={style}
      {...accessibility}
    >
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element -- a small same-origin JPEG; next/image would only re-encode it
        <img
          src={photo}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailedPhoto(photo)}
        />
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {motif.paths}
        </svg>
      )}
    </span>
  );
}
