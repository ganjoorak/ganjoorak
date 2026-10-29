"use client";

import type { CSSProperties } from "react";
import ProfileAvatar from "@/components/ProfileAvatar";
import { personAccent } from "@/components/stories/storyState";
import type { StoryPerson } from "@/utils/quotesApi";

interface StoriesRowProps {
  /** Already ordered: unseen first. */
  people: StoryPerson[];
  isUnseen: (person: StoryPerson) => boolean;
  onOpen: (index: number) => void;
}

/**
 * The menu's row of followed people with a recent fragment: round avatars ringed in the person's accent
 * while unseen, grey once seen, with the name underneath. Renders nothing for an empty list.
 */
export default function StoriesRow({ people, isUnseen, onOpen }: StoriesRowProps) {
  if (people.length === 0) return null;

  return (
    <section className="menu-stories" aria-labelledby="menu-stories-title">
      <h2 id="menu-stories-title" className="menu-section-title">
        تکه‌ها
      </h2>
      <ul className="menu-stories-list">
        {people.map((person, index) => {
          const unseen = isUnseen(person);
          const accent = personAccent(person);
          return (
            <li key={person.user.username}>
              <button
                type="button"
                className={`menu-story${unseen ? "" : " is-seen"}`}
                style={accent ? ({ "--story-accent": accent } as CSSProperties) : undefined}
                onClick={() => onOpen(index)}
                aria-label={`تکه‌های ${person.user.displayName}${unseen ? "، تازه" : ""}`}
              >
                <span className="menu-story-ring">
                  <ProfileAvatar
                    username={person.user.username}
                    avatar={person.user.avatar}
                    className="menu-story-avatar"
                    decorative
                  />
                </span>
                <span className="menu-story-name">{person.user.displayName}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
