"use client";

import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import ProfileAvatar from "@/components/ProfileAvatar";
import { cn } from "@/lib/utils";
import { verseEdges } from "@/utils/moshaereLetters";
import type { MoshaereMove } from "@/utils/moshaereApi";
import { publicProfilePath } from "@/utils/accountApi";
import "../../styles/ProfileSections.css";
import "../../styles/Moshaere.css";

const timeFormatter = new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit" });

/**
 * Each mesra of a verse as text, with the connecting letters marked the way search results mark a
 * match (start and/or end of the verse).
 */
export function markLines(lines: readonly string[], highlight: "both" | "start" | "none" = "both"): ReactNode[] {
  const { start, end } = verseEdges(lines);
  return lines.map((line, index) => {
    // Cut the line into plain text and the letters to mark.
    const marks = [
      highlight !== "none" && start?.line === index ? { ...start, kind: "start" as const } : null,
      highlight === "both" && end?.line === index ? { ...end, kind: "end" as const } : null,
    ]
      .filter((mark): mark is NonNullable<typeof mark> => mark !== null)
      .sort((a, b) => a.at - b.at);
    let cursor = 0;
    return (
      <Fragment key={index}>
        {marks.map((mark) => {
          const before = line.slice(cursor, mark.at);
          cursor = mark.at + mark.length;
          return (
            <Fragment key={mark.kind}>
              {before}
              <mark className="search-highlight">{line.slice(mark.at, cursor)}</mark>
            </Fragment>
          );
        })}
        {line.slice(cursor)}
      </Fragment>
    );
  });
}

/** The chain of verses of a room or a match, oldest first, as the profile's verse cards (search-result typography). */
export default function MoveChain({
  moves,
  viewer,
  teamOf,
  freshAfter = Infinity,
}: {
  moves: MoshaereMove[];
  viewer?: string;
  /** username -> team index (matches): each move is tinted by its author's team. */
  teamOf?: Record<string, number>;
  /** Moves with a larger id than this animate in; the first load stays still. */
  freshAfter?: number;
}) {
  return (
    <ol className="quote-list" aria-label="زنجیرهٔ بیت‌ها">
      {moves.map((move) => {
        const team = teamOf?.[move.username];
        const marked = markLines(move.lines);
        return (
          <li
            key={move.id}
            className={cn(
              "quote-card msh-move",
              move.username === viewer && "is-mine",
              team !== undefined && `is-team-${team}`,
              move.id > freshAfter && "is-new",
            )}
          >
            <blockquote className="search-hit-verse">
              <span className="search-hit-couplet">
                {marked.map((line, index) => (
                  <span key={index} className="search-hit-line is-match">
                    {line}
                  </span>
                ))}
              </span>
            </blockquote>
            <div className="search-hit-meta">
              <Link
                href={publicProfilePath(move.username)}
                prefetch={false}
                className="inline-flex min-w-0 items-center gap-2 text-foreground hover:underline"
              >
                <ProfileAvatar username={move.username} avatar={move.avatar} className="size-6!" decorative />
                <strong className="truncate">{move.displayName}</strong>
              </Link>
              {move.key && move.href && (
                <Link href={move.href} prefetch={false} className="quote-source search-hit-crumb">
                  <strong className="quote-poet">{move.poetName}</strong>
                  {move.poemTitle && <span>{move.poemTitle}</span>}
                </Link>
              )}
              <time className="ms-auto" dateTime={new Date(move.createdAt).toISOString()}>
                {timeFormatter.format(new Date(move.createdAt))}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
