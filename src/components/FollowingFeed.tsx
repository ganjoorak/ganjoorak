"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { FaUserPlus, FaUsers } from "react-icons/fa";
import FeedModeEmpty from "@/components/FeedModeEmpty";
import FollowUserButton from "@/components/FollowUserButton";
import ProfileAvatar from "@/components/ProfileAvatar";
import StoriesRow from "@/components/stories/StoriesRow";
import StoryViewer from "@/components/stories/StoryViewer";
import { buttonVariants } from "@/components/ui/button";
import { useAccountSession } from "@/hooks/useAccountSession";
import { markStorySeen, useFollowingStories } from "@/hooks/useFollowingStories";
import { formatRelativeTime } from "@/components/profile/profileFormat";
import { AccountError, fetchFollowList, publicProfilePath } from "@/utils/accountApi";
import type { Quote, StoryPerson } from "@/utils/quotesApi";

interface FollowingFeedProps {
  switcher: ReactNode;
}

interface FollowedPost {
  person: StoryPerson;
  quote: Quote;
}

/**
 * Home-feed tab «دنبال‌شده‌ها»: stories (تکه‌ها) and the same quotes as a
 * vertical list of posts, from people the signed-in reader follows.
 */
const FollowingFeed = ({ switcher }: FollowingFeedProps) => {
  const { isSignedIn, isLoading: sessionLoading } = useAccountSession();
  const stories = useFollowingStories();
  const [followingCount, setFollowingCount] = useState<number | null>(null);
  const [listError, setListError] = useState("");
  const [viewer, setViewer] = useState<{ people: StoryPerson[]; startIndex: number } | null>(
    null,
  );

  useEffect(() => {
    if (!isSignedIn) {
      setFollowingCount(null);
      return;
    }
    let cancelled = false;
    fetchFollowList("following")
      .then((users) => {
        if (!cancelled) {
          setFollowingCount(users.length);
          setListError("");
        }
      })
      .catch((caught) => {
        if (cancelled) return;
        setFollowingCount(0);
        setListError(caught instanceof AccountError ? caught.message : "خطایی رخ داد.");
      });
    return () => {
      cancelled = true;
    };
  }, [isSignedIn]);

  const posts = useMemo<FollowedPost[]>(() => {
    const items: FollowedPost[] = [];
    for (const person of stories.people) {
      for (const quote of person.quotes) {
        items.push({ person, quote });
      }
    }
    return items.sort((a, b) => b.quote.createdAt - a.quote.createdAt);
  }, [stories.people]);

  const switcherBar = <div className="followed-feed-switch">{switcher}</div>;

  if (sessionLoading) {
    return (
      <main className="followed-feed" dir="rtl">
        {switcherBar}
        <p className="followed-feed-empty" role="status">
          در حال بارگذاری…
        </p>
      </main>
    );
  }

  if (!isSignedIn) {
    return (
      <FeedModeEmpty
        switcher={switcher}
        icon={<FaUserPlus />}
        title="وارد شوید"
        description="برای دیدن تکه‌ها و نوشته‌های کسانی که دنبال می‌کنید وارد حساب شوید."
        actions={
          <Link href="/login" className={buttonVariants({ size: "lg" })}>
            ورود
          </Link>
        }
      />
    );
  }

  if (followingCount === 0) {
    return (
      <FeedModeEmpty
        switcher={switcher}
        icon={<FaUsers />}
        title="هنوز کسی را دنبال نمی‌کنید"
        description={
          listError ||
          "در نمایهٔ هر کس «دنبال کردن» را بزنید تا تکه‌ها و نوشته‌هایشان اینجا بیاید."
        }
        actions={
          <Link href="/following" className={buttonVariants({ variant: "ghost", size: "lg" })}>
            فهرست دنبال‌شده‌ها
          </Link>
        }
      />
    );
  }

  return (
    <main className="followed-feed" dir="rtl">
      {switcherBar}
      <StoriesRow
        people={stories.people}
        isUnseen={stories.isUnseen}
        onOpen={(index) => setViewer({ people: stories.people, startIndex: index })}
      />
      {followingCount === null && posts.length === 0 ? (
        <p className="followed-feed-empty" role="status">
          در حال بارگذاری…
        </p>
      ) : posts.length === 0 ? (
        <p className="followed-feed-empty">هنوز تکه‌ای از دنبال‌شده‌ها نیست.</p>
      ) : (
        <ul className="followed-feed-posts">
          {posts.map(({ person, quote }) => (
            <li key={`${person.user.username}-${quote.id}`} className="followed-feed-post">
              <div className="followed-feed-author">
                <Link href={publicProfilePath(person.user.username)} className="followed-feed-author-link">
                  <ProfileAvatar
                    username={person.user.username}
                    avatar={person.user.avatar}
                    decorative
                  />
                  <span>
                    <span className="followed-feed-author-name">
                      {person.user.displayName || person.user.username}
                    </span>
                    <span className="followed-feed-author-meta">
                      {" · "}
                      {formatRelativeTime(quote.createdAt)}
                    </span>
                  </span>
                </Link>
                <FollowUserButton
                  username={person.user.username}
                  displayName={person.user.displayName || person.user.username}
                  signedIn
                />
              </div>
              <blockquote className="search-hit-verse">
                {quote.lines.map((line, index) => (
                  <span key={index} className="search-hit-line is-match">
                    {line}
                  </span>
                ))}
              </blockquote>
              <Link href={quote.href} prefetch={false} className="quote-source search-hit-crumb">
                <strong className="quote-poet">{quote.poetName}</strong>
                <span>{quote.poemTitle}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {viewer && (
        <StoryViewer
          people={viewer.people}
          startIndex={viewer.startIndex}
          onSeen={markStorySeen}
          onClose={() => setViewer(null)}
        />
      )}
    </main>
  );
};

export default FollowingFeed;
