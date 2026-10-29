"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FaCheck, FaUserPlus } from "react-icons/fa";
import { Button } from "@/components/ui/button";
import {
  AccountError,
  fetchFollowState,
  followUser,
  unfollowUser,
} from "@/utils/accountApi";

/**
 * Follow / unfollow one person. `signedIn` comes from the page, which already
 * asked who the viewer is; signed out, the button leads to the login page.
 */
export default function FollowUserButton({
  username,
  displayName,
  signedIn,
  onChange,
}: {
  username: string;
  displayName: string;
  signedIn: boolean;
  /** Called after the server accepted a change, so the page can fix its follower count. */
  onChange?: (following: boolean) => void;
}) {
  const router = useRouter();
  // null until the server has said whether the viewer follows this person.
  const [following, setFollowing] = useState<boolean | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!signedIn) {
      return;
    }
    let cancelled = false;
    fetchFollowState(username)
      .then((value) => !cancelled && setFollowing(value))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [signedIn, username]);

  const handleClick = async () => {
    if (!signedIn) {
      router.push("/login");
      return;
    }
    if (following === null || isSaving) {
      return;
    }
    setError("");
    setIsSaving(true);
    try {
      const next = following ? await unfollowUser(username) : await followUser(username);
      setFollowing(next.following);
      onChange?.(next.following);
    } catch (caught) {
      setError(caught instanceof AccountError ? caught.message : "خطایی رخ داد.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={following ? "secondary" : "default"}
        className="account-pill"
        aria-pressed={following === true}
        aria-label={following ? `لغو دنبال کردن ${displayName}` : `دنبال کردن ${displayName}`}
        disabled={isSaving || (signedIn && following === null)}
        onClick={handleClick}
      >
        {following ? <FaCheck aria-hidden="true" /> : <FaUserPlus aria-hidden="true" />}
        {following ? "دنبال می‌کنید" : "دنبال کردن"}
      </Button>
      {error && (
        <span role="alert" className="follow-error">
          {error}
        </span>
      )}
    </>
  );
}
