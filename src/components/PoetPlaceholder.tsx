import type React from "react";
import ProfileAvatar from "@/components/ProfileAvatar";

/**
 * Stand-in portrait for poets without one (see isPlaceholderPoetImage): the same poetry
 * line motifs as profile pictures, picked from the poet's slug, on theme colours.
 */
export default function PoetPlaceholder({
  seed,
  className,
  style,
}: {
  seed: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <ProfileAvatar
      username={seed || "poet"}
      decorative
      className={["poet-placeholder", className].filter(Boolean).join(" ")}
      style={style}
    />
  );
}
