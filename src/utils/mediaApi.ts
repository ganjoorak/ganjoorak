import { request, type AccountUser } from "@/utils/accountApi";

// Uploaded profile pictures and banners. Contract: docs/social-api-contract.md §3.1.
// The stored value of `avatar` / `banner` is "img:<32 hex id>"; the image itself is served,
// without a session, from /api/account/media/<id>.jpg.

export type UploadedImage = `img:${string}`;

const UPLOADED_IMAGE = /^img:([0-9a-f]{32})$/;

/** True for a well-formed "img:<id>" value. */
export const isUploadedImage = (value: string | undefined | null): value is UploadedImage =>
  typeof value === "string" && UPLOADED_IMAGE.test(value);

/** The URL of an uploaded image, or null for anything else (presets, "", unknown values). */
export const mediaUrl = (value: string | undefined | null): string | null => {
  const id = typeof value === "string" ? UPLOADED_IMAGE.exec(value)?.[1] : undefined;
  return id ? `/api/account/media/${id}.jpg` : null;
};

const sendImage = (kind: "avatar" | "banner", blob: Blob) =>
  request<{ user: AccountUser }>(`uploads/${kind}`, {
    method: "POST",
    headers: { "Content-Type": blob.type || "image/jpeg" },
    body: blob,
  }).then((body) => body.user);

const removeImage = (kind: "avatar" | "banner") =>
  request<{ user: AccountUser }>(`uploads/${kind}`, { method: "DELETE" }).then((body) => body.user);

/** The server crops, scales and re-encodes; clients send an already-cropped JPEG (≤ 2 MB). */
export const uploadAvatar = (blob: Blob) => sendImage("avatar", blob);
/** ≤ 4 MB. */
export const uploadBanner = (blob: Blob) => sendImage("banner", blob);
export const removeAvatar = () => removeImage("avatar");
export const removeBanner = () => removeImage("banner");
