"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, Share2 } from "lucide-react";
import ProfileAvatar from "@/components/ProfileAvatar";
import { Button } from "@/components/ui/button";
import { bannerBackground, formatDate } from "@/components/profile/profileFormat";
import { publicProfilePath } from "@/utils/accountApi";
import { formatPersianNumber } from "@/utils/searchText";
import "../../styles/ProfileHeader.css";

export interface ProfileHeaderData {
  username: string;
  displayName: string;
  avatar: string;
  bio: string;
  banner: string;
  createdAt: number;
  followerCount?: number;
  followingCount?: number;
}

/** Counts are public; only the owner may open the lists behind them. */
const FollowCount = ({ href, count, label }: { href?: string; count: number; label: string }) => {
  const content = (
    <>
      <strong>{formatPersianNumber(count)}</strong> {label}
    </>
  );
  return href ? (
    <Link href={href} className="profile-follow-link">
      {content}
    </Link>
  ) : (
    <span>{content}</span>
  );
};

/** Shares the public link (/@username): the system share sheet, else the clipboard. */
export function ShareProfileButton({ profile }: { profile: Pick<ProfileHeaderData, "username" | "displayName"> }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const handleShare = async () => {
    const url = `${window.location.origin}${publicProfilePath(profile.username)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `${profile.displayName} در گنجورک`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // The share sheet was dismissed or the clipboard is blocked; nothing to do.
    }
  };

  return (
    <Button type="button" variant="outline" className="profile-action" onClick={handleShare}>
      {copied ? <Check aria-hidden="true" /> : <Share2 aria-hidden="true" />}
      {copied ? "پیوند کپی شد" : "اشتراک‌گذاری"}
    </Button>
  );
}

/**
 * Substack-style header: banner, a round avatar overlapping its edge, name,
 * @username, bio, follow counts, then the page's primary buttons (`children`).
 */
export default function ProfileHeader({
  profile,
  isOwner,
  children,
}: {
  profile: ProfileHeaderData;
  isOwner: boolean;
  children?: ReactNode;
}) {
  const hasCounts = profile.followerCount !== undefined && profile.followingCount !== undefined;

  return (
    <header className="profile-header">
      <div
        className="profile-banner"
        style={bannerBackground(profile.banner)}
        aria-hidden="true"
      />
      <div className="profile-identity">
        <ProfileAvatar
          username={profile.username}
          avatar={profile.avatar}
          className="profile-header-avatar"
        />
        <h1 className="profile-name">{profile.displayName}</h1>
        <p className="profile-username" dir="ltr">
          @{profile.username}
        </p>
        {profile.bio && <p className="profile-bio">{profile.bio}</p>}
        <p className="profile-meta">
          {hasCounts && (
            <>
              <FollowCount
                href={isOwner ? "/following?tab=followers" : undefined}
                count={profile.followerCount!}
                label="دنبال‌کننده"
              />
              <span aria-hidden="true">·</span>
              <FollowCount
                href={isOwner ? "/following" : undefined}
                count={profile.followingCount!}
                label="دنبال‌شده"
              />
              <span aria-hidden="true">·</span>
            </>
          )}
          <span>عضو از {formatDate(profile.createdAt)}</span>
        </p>
        {children && <div className="profile-actions">{children}</div>}
      </div>
    </header>
  );
}
