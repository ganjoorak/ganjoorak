"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FaChevronLeft, FaPlus, FaTrophy } from "react-icons/fa";
import { JoinPrompt } from "@/components/moshaere/PublicRoom";
import NewMatchDialog from "@/components/moshaere/NewMatchDialog";
import {
  TURN_LABELS,
  activePlayers,
  canStart,
  chipClass,
  errorText,
  isMyTurn,
  joinedPlayers,
  namesOf,
  otherTeam,
  sizeLabel,
  type ViewerState,
} from "@/components/moshaere/shared";
import TeamStack from "@/components/moshaere/TeamStack";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyIcon } from "@/components/ui/empty";
import { FormError } from "@/components/ui/form-error";
import {
  acceptMatch,
  cancelMatch,
  declineMatch,
  startMatch,
  type Match,
} from "@/utils/moshaereApi";
import { formatPersianNumber } from "@/utils/searchText";
import "../../styles/Moshaere.css";

export interface MatchList {
  matches: Match[];
  invites: number;
  yourTurn: number;
}

type RowKind = "invite" | "turn" | "waiting" | "hosted" | "accepted" | "finished";

const END_REASONS = { timeout: "زمان نوبت تمام شد", resign: "همه ترک کردند", "": "" } as const;

function MatchRow({
  match,
  kind,
  onChanged,
}: {
  match: Match;
  kind: RowKind;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mine = match.teams[Math.max(match.myTeam, 0)];
  const theirs = match.teams[otherTeam(match)];
  const moves = match.teams[0].moveCount + match.teams[1].moveCount;
  const solo = activePlayers(mine).length === 1 && activePlayers(theirs).length === 1;
  const joined = match.teams.reduce((sum, team) => sum + joinedPlayers(team).length, 0);
  const total = match.teams.reduce((sum, team) => sum + activePlayers(team).length, 0);

  const act = async (action: () => Promise<Match>, goToMatch = false) => {
    setBusy(true);
    setError("");
    try {
      const updated = await action();
      if (goToMatch) router.push(`/moshaere/${updated.id}`);
      else onChanged();
    } catch (caught) {
      setError(errorText(caught));
      setBusy(false);
    }
  };

  const settings = `${TURN_LABELS[match.turnSeconds]} · جست‌وجو ${match.assist ? "روشن" : "خاموش"}`;
  const state =
    kind === "invite"
      ? settings
      : kind === "hosted"
        ? `${formatPersianNumber(joined)} از ${formatPersianNumber(total)} نفر پذیرفته‌اند · ${settings}`
        : kind === "accepted"
          ? `منتظر شروع مسابقه · ${settings}`
          : kind === "finished"
            ? [END_REASONS[match.endReason], `${formatPersianNumber(moves)} بیت`].filter(Boolean).join(" · ")
            : [
                kind === "turn"
                  ? "نوبت تیم شما"
                  : match.myState === "left"
                    ? "مسابقه را ترک کرده‌اید"
                    : "منتظر تیم حریف",
                `${formatPersianNumber(moves)} بیت`,
                TURN_LABELS[match.turnSeconds],
              ].join(" · ");
  const meta = solo ? state : [state, namesOf(theirs)].filter(Boolean).join(" · ");
  const won = match.winnerTeam === match.myTeam;

  return (
    <li className="follow-item msh-match">
      <Link href={`/moshaere/${match.id}`} prefetch={false} className="app-row follow-link">
        <span className="msh-versus">
          <TeamStack team={mine} />
          <span className="msh-versus-sep" aria-hidden="true" />
          <TeamStack team={theirs} />
        </span>
        <span className="app-row-body">
          <span className="app-row-title">{solo ? activePlayers(theirs)[0].displayName : sizeLabel(match)}</span>
          <span className="app-row-meta">{meta}</span>
        </span>
        {kind === "turn" && match.nextLetter && (
          <span className={chipClass("strong", "text-sm")} title="حرف آغاز بیت شما">
            «{match.nextLetter}»
          </span>
        )}
        {kind === "finished" && (
          <span className={chipClass(won ? "positive" : "negative")}>{won ? "بردید" : "باختید"}</span>
        )}
        <FaChevronLeft className="app-row-chevron" aria-hidden="true" />
      </Link>
      {kind === "invite" && (
        <div className="msh-match-actions">
          <Button type="button" size="sm" disabled={busy} onClick={() => void act(() => acceptMatch(match.id), true)}>
            پذیرفتن
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void act(() => declineMatch(match.id))}
          >
            رد کردن
          </Button>
        </div>
      )}
      {kind === "hosted" && (
        <div className="msh-match-actions">
          <Button
            type="button"
            size="sm"
            disabled={busy || !canStart(match)}
            onClick={() => void act(() => startMatch(match.id), true)}
          >
            شروع
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void act(() => cancelMatch(match.id))}
          >
            لغو
          </Button>
        </div>
      )}
      {error && <FormError className="msh-match-error">{error}</FormError>}
    </li>
  );
}

/** My matches, grouped by what needs doing; the list itself is loaded by the page. */
export default function MatchesTab({
  viewer,
  list,
  error,
  onReload,
}: {
  viewer: ViewerState;
  list: MatchList | null;
  error: string;
  onReload: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const closeDialog = useCallback(() => setCreating(false), []);

  if (viewer.status !== "in") {
    return <JoinPrompt viewer={viewer} forbidden="" />;
  }

  const matches = list?.matches ?? [];
  const sections: { title: string; kind: RowKind; items: Match[] }[] = [
    {
      title: "دعوت‌ها",
      kind: "invite",
      items: matches.filter((m) => m.status === "pending" && m.myState === "invited"),
    },
    {
      title: "نوبت تیم شماست",
      kind: "turn",
      items: matches.filter(isMyTurn),
    },
    {
      title: "منتظر تیم حریف",
      kind: "waiting",
      items: matches.filter((m) => m.status === "active" && !isMyTurn(m)),
    },
    {
      title: "دعوت‌های فرستاده‌شده",
      kind: "hosted",
      items: matches.filter((m) => m.status === "pending" && m.myState !== "invited" && m.host === viewer.user.username),
    },
    {
      title: "منتظر شروع",
      kind: "accepted",
      items: matches.filter((m) => m.status === "pending" && m.myState === "joined" && m.host !== viewer.user.username),
    },
    {
      title: "پایان‌یافته‌های اخیر",
      kind: "finished",
      items: matches.filter((m) => m.status === "finished"),
    },
  ];
  const visible = sections.filter((section) => section.items.length > 0);

  return (
    <div>
      <Button type="button" size="lg" className="mb-5 h-11 w-full gap-2 text-sm" onClick={() => setCreating(true)}>
        <FaPlus aria-hidden="true" />
        مسابقهٔ تازه
      </Button>

      {error && <FormError>{error}</FormError>}

      {list === null && !error && (
        <Empty role="status">
          <EmptyDescription>در حال بارگذاری…</EmptyDescription>
        </Empty>
      )}

      {list !== null && visible.length === 0 && (
        <Empty>
          <EmptyIcon>
            <FaTrophy />
          </EmptyIcon>
          <EmptyDescription>
            هنوز مسابقه‌ای ندارید. با یک دوست رودررو بازی کنید، یا تیمی با دوستانتان بسازید و با تیم دیگری مسابقه بدهید.
          </EmptyDescription>
        </Empty>
      )}

      {visible.map((section) => (
        <section key={section.kind} className="app-section">
          <h2 className="app-section-title">
            {section.title}
            <span>{formatPersianNumber(section.items.length)}</span>
          </h2>
          <ul className="app-list">
            {section.items.map((match) => (
              <MatchRow key={match.id} match={match} kind={section.kind} onChanged={onReload} />
            ))}
          </ul>
        </section>
      ))}

      {creating && <NewMatchDialog onClose={closeDialog} />}
    </div>
  );
}
