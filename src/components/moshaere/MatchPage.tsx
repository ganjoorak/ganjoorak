"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FaChevronLeft, FaDoorOpen, FaFlag, FaHourglassHalf, FaTrophy } from "react-icons/fa";
import AppPage from "@/components/AppPage";
import Composer from "@/components/moshaere/Composer";
import MoveChain from "@/components/moshaere/MoveChain";
import { JoinPrompt } from "@/components/moshaere/PublicRoom";
import {
  TURN_LABELS,
  activePlayers,
  canStart,
  chipClass,
  errorText,
  isMyTurn,
  joinedPlayers,
  lastId,
  mergeMoves,
  nearBottom,
  otherTeam,
  scrollToBottom,
  sizeLabel,
  teamIndexByUser,
  teamName,
  useViewer,
  useVisibleInterval,
  type ViewerState,
} from "@/components/moshaere/shared";
import ProfileAvatar from "@/components/ProfileAvatar";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeader, DialogPopup, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Empty, EmptyActions, EmptyDescription, EmptyIcon, EmptyTitle } from "@/components/ui/empty";
import { FormError } from "@/components/ui/form-error";
import { cn } from "@/lib/utils";
import { AccountError, publicProfilePath } from "@/utils/accountApi";
import {
  acceptMatch,
  cancelMatch,
  createMatch,
  declineMatch,
  fetchMatch,
  leaveMatch,
  postMatchMove,
  startMatch,
  type Match,
  type MatchPlayer,
  type MoshaereMove,
  type VerseInput,
} from "@/utils/moshaereApi";
import { formatPersianNumber } from "@/utils/searchText";
import "../../styles/Moshaere.css";

const POLL_MS = 2000;
const twoDigits = new Intl.NumberFormat("fa-IR", { minimumIntegerDigits: 2 });

const formatCountdown = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const tail = `${twoDigits.format(minutes)}:${twoDigits.format(seconds)}`;
  return hours > 0 ? `${formatPersianNumber(hours)}:${tail}` : tail;
};

/** Time left on the turn, by the server's clock: the device clock may be minutes off. */
function useTurnClock(deadline: number, offset: number) {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (deadline <= 0) {
      setRemaining(null);
      return;
    }
    const tick = () => setRemaining(deadline - (Date.now() + offset));
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [deadline, offset]);
  return remaining;
}

const PLAYER_STATES = {
  invited: { label: "دعوت‌شده", tone: "muted" },
  declined: { label: "رد کرد", tone: "negative" },
  left: { label: "ترک کرد", tone: "muted" },
} as const;

function PlayerRow({ player, match, mine }: { player: MatchPlayer; match: Match; mine: boolean }) {
  const meta = [
    mine ? "شما" : "",
    player.username === match.host ? "میزبان" : "",
    match.status === "pending" ? "" : `${formatPersianNumber(player.moveCount)} بیت`,
  ]
    .filter(Boolean)
    .join(" · ");
  const badge =
    player.state === "joined"
      ? match.status === "pending"
        ? { label: "پذیرفت", tone: "positive" as const }
        : null
      : PLAYER_STATES[player.state];
  return (
    <li className={cn(player.state !== "joined" && match.status !== "pending" && "msh-player--away")}>
      <Link href={publicProfilePath(player.username)} prefetch={false} className="app-row follow-link">
        <ProfileAvatar
          username={player.username}
          avatar={player.avatar}
          className="follow-avatar"
          style={
            player.accent
              ? { boxShadow: `inset 0 0 0 1px rgb(var(--border)), 0 0 0 2px ${player.accent}` }
              : undefined
          }
          decorative
        />
        <span className="app-row-body">
          <span className="app-row-title">{player.displayName}</span>
          {meta && <span className="app-row-meta">{meta}</span>}
        </span>
        {badge && <span className={chipClass(badge.tone)}>{badge.label}</span>}
        <FaChevronLeft className="app-row-chevron" aria-hidden="true" />
      </Link>
    </li>
  );
}

/** One team as a section of player rows; the team on turn is outlined and carries the countdown. */
function TeamSection({
  match,
  index,
  countdown,
  urgent,
  me,
}: {
  match: Match;
  index: number;
  me: string;
  countdown: string | null;
  urgent: boolean;
}) {
  const team = match.teams[index];
  const onTurn = match.status === "active" && match.turnTeam === index;
  const finished = match.status === "finished";
  const won = finished && match.winnerTeam === index;
  return (
    <section className={cn("app-section msh-team", onTurn && "is-turn")} aria-label={teamName(match, index)}>
      <h2 className="app-section-title">
        <span>
          {teamName(match, index)}
          <span className="ms-2 font-normal">
            {formatPersianNumber(activePlayers(team).length)} نفر · {formatPersianNumber(team.moveCount)} بیت
          </span>
        </span>
        {onTurn && (
          <span
            className={chipClass(urgent ? "urgent" : "primary", cn("text-sm", urgent && "motion-safe:animate-pulse"))}
            aria-live="off"
          >
            نوبت
            {countdown && (
              <span className="tabular-nums" dir="ltr">
                {countdown}
              </span>
            )}
          </span>
        )}
        {finished && <span className={chipClass(won ? "positive" : "muted")}>{won ? "برنده" : "بازنده"}</span>}
      </h2>
      <ul className="app-list" aria-label={`بازیکنان ${teamName(match, index)}`}>
        {team.players.map((player) => (
          <PlayerRow key={player.username} player={player} match={match} mine={player.username === me} />
        ))}
      </ul>
    </section>
  );
}

const settingsText = (match: Match) =>
  `زمان هر نوبت ${TURN_LABELS[match.turnSeconds]} است و جست‌وجو ${match.assist ? "روشن" : "خاموش"} است.`;

/** One match: the two teams, the chain, and whatever the match's state asks of me. */
export default function MatchPage({ id }: { id: number }) {
  const router = useRouter();
  const viewer = useViewer();
  const me = viewer.status === "in" ? viewer.user.username : "";

  const [match, setMatch] = useState<Match | null>(null);
  const [moves, setMoves] = useState<MoshaereMove[]>([]);
  const [offset, setOffset] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [assist, setAssist] = useState(false);

  const movesRef = useRef<MoshaereMove[]>([]);
  movesRef.current = moves;
  const freshAfter = useRef(Infinity);
  const pendingScroll = useRef<"auto" | "smooth" | null>(null);

  // Applies a server answer: the match's state, the server clock, and any moves in it.
  const apply = useCallback((next: Match, scroll: "auto" | "smooth" | "ifNear") => {
    setOffset(next.now - Date.now());
    const incoming = [...next.moves, ...(next.lastMove ? [next.lastMove] : [])];
    if (scroll === "ifNear") {
      if (incoming.some((move) => move.id > lastId(movesRef.current)) && nearBottom()) {
        pendingScroll.current = "smooth";
      }
    } else {
      pendingScroll.current = scroll;
    }
    setMoves((current) => mergeMoves(current, incoming));
    setMatch(next);
  }, []);

  const load = useCallback(() => {
    fetchMatch(id)
      .then((next) => {
        freshAfter.current = lastId(next.moves);
        apply(next, "auto");
      })
      .catch((caught) => setLoadError(errorText(caught)));
  }, [apply, id]);

  useEffect(() => {
    if (viewer.status === "in") load();
  }, [viewer.status, load]);

  const poll = useCallback(async () => {
    apply(await fetchMatch(id, lastId(movesRef.current) || undefined), "ifNear");
  }, [apply, id]);

  // Pending matches change too: invitees answer and the host may start.
  const status = match?.status;
  useVisibleInterval(poll, POLL_MS, status === "active" || status === "pending");

  useEffect(() => {
    if (!pendingScroll.current) return;
    const smooth = pendingScroll.current === "smooth";
    pendingScroll.current = null;
    scrollToBottom(smooth);
  }, [moves]);

  const remaining = useTurnClock(match?.turnDeadline ?? 0, offset);

  // The deadline passed on the server's clock: ask right away so the result shows without waiting.
  const timedOut = remaining !== null && remaining <= 0;
  useEffect(() => {
    if (!timedOut) return;
    void poll().catch(() => undefined);
    const timer = window.setInterval(() => void poll().catch(() => undefined), 1500);
    return () => window.clearInterval(timer);
  }, [timedOut, poll]);

  const run = async (action: () => Promise<Match>) => {
    setBusy(true);
    setActionError("");
    try {
      apply(await action(), "ifNear");
    } catch (caught) {
      setActionError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const send = async (verse: VerseInput) => {
    setSending(true);
    setError("");
    try {
      apply(await postMatchMove(id, verse), "smooth");
      return true;
    } catch (caught) {
      if (caught instanceof AccountError && caught.status === 409) {
        await poll().catch(() => undefined);
      }
      setError(errorText(caught));
      return false;
    } finally {
      setSending(false);
    }
  };

  // The same teams and settings again; whoever asks becomes the host of the new match.
  const rematch = async () => {
    if (!match || match.myTeam < 0) return;
    setBusy(true);
    setActionError("");
    try {
      const names = (team: number) =>
        match.teams[team].players.map((player) => player.username).filter((name) => name !== me);
      const next = await createMatch({
        allies: names(match.myTeam),
        opponents: names(otherTeam(match)),
        assist: match.assist,
        turnSeconds: match.turnSeconds,
      });
      router.push(`/moshaere/${next.id}`);
    } catch (caught) {
      setActionError(errorText(caught));
      setBusy(false);
    }
  };

  const solo = match ? activePlayers(match.teams[0]).length === 1 && activePlayers(match.teams[1]).length === 1 : false;
  const title = !match
    ? "مسابقه"
    : solo
      ? `مشاعره با ${activePlayers(match.teams[otherTeam(match)])[0].displayName}`
      : `مشاعرهٔ ${sizeLabel(match)}`;

  const wrap = (children: React.ReactNode) => (
    <AppPage
      title={title}
      backHref="/moshaere?tab=matches"
      width="narrow"
      className="msh-page msh-page--match"
      actions={
        match?.status === "active" && match.myState === "joined" ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="gap-1.5 rounded-full px-3"
            onClick={() => setConfirmLeave(true)}
          >
            <FaDoorOpen aria-hidden="true" />
            ترک مسابقه
          </Button>
        ) : undefined
      }
    >
      {children}
    </AppPage>
  );

  if (viewer.status !== "in") {
    return wrap(<ViewerGate viewer={viewer} />);
  }
  if (!match) {
    return wrap(
      loadError ? (
        <Empty>
          <EmptyDescription>{loadError}</EmptyDescription>
          <Link href="/moshaere?tab=matches" className={buttonVariants({ variant: "outline" })}>
            بازگشت به مسابقه‌ها
          </Link>
        </Empty>
      ) : (
        <Empty role="status">
          <EmptyDescription>در حال بارگذاری…</EmptyDescription>
        </Empty>
      ),
    );
  }

  const myTurn = isMyTurn(match);
  const mine = match.myTeam >= 0;
  const countdown = remaining === null ? null : formatCountdown(remaining);
  const urgent = remaining !== null && remaining <= 10_000 && match.turnSeconds <= 180;
  const iAmHost = match.host === me;
  const hostPlayer = match.teams[0].players.find((player) => player.username === match.host);
  const hostName = hostPlayer?.displayName ?? match.host;
  const joined = match.teams.reduce((sum, team) => sum + joinedPlayers(team).length, 0);
  const total = match.teams.reduce((sum, team) => sum + activePlayers(team).length, 0);
  const won = mine && match.winnerTeam === match.myTeam;
  const lastOfMyTeam = mine && joinedPlayers(match.teams[match.myTeam]).length <= 1;
  // Your own team first, like the rows of the list.
  const order = mine ? [match.myTeam, otherTeam(match)] : [0, 1];
  const teamOf = teamIndexByUser(match);

  const finishedText = () => {
    if (!mine) return `${teamName(match, match.winnerTeam)} برنده شد.`;
    const loser = 1 - match.winnerTeam;
    const who = loser === match.myTeam ? "تیم شما" : "تیم حریف";
    return match.endReason === "timeout"
      ? `زمان نوبت ${who} تمام شد.`
      : match.endReason === "resign"
        ? `همهٔ اعضای ${who} مسابقه را ترک کردند.`
        : "";
  };

  return wrap(
    <>
      {order.map((index) => (
        <TeamSection key={index} match={match} index={index} me={me} countdown={countdown} urgent={urgent} />
      ))}

      {match.status === "pending" && (
        <Empty className="py-6">
          <EmptyIcon>
            <FaHourglassHalf />
          </EmptyIcon>
          {match.myState === "invited" ? (
            <>
              <EmptyDescription>
                {hostName} شما را به مشاعره دعوت کرده است ({sizeLabel(match)}). {settingsText(match)} تیم میزبان اولین بیت
                را می‌خواند.
              </EmptyDescription>
              <EmptyActions>
                <Button type="button" disabled={busy} onClick={() => void run(() => acceptMatch(id))}>
                  پذیرفتن
                </Button>
                <Button type="button" variant="outline" disabled={busy} onClick={() => void run(() => declineMatch(id))}>
                  رد کردن
                </Button>
              </EmptyActions>
            </>
          ) : iAmHost ? (
            <>
              <EmptyDescription>
                {formatPersianNumber(joined)} از {formatPersianNumber(total)} نفر دعوت را پذیرفته‌اند. با پاسخ همه، مسابقه خودکار شروع
                می‌شود؛ یا زودتر شروع کنید و دعوت‌های بی‌پاسخ رد می‌شوند. {settingsText(match)}
              </EmptyDescription>
              <EmptyActions>
                <Button type="button" disabled={busy || !canStart(match)} onClick={() => void run(() => startMatch(id))}>
                  شروع الان
                </Button>
                <Button type="button" variant="outline" disabled={busy} onClick={() => void run(() => cancelMatch(id))}>
                  لغو مسابقه
                </Button>
              </EmptyActions>
              {!canStart(match) && (
                <EmptyDescription className="text-xs">برای شروع، از هر دو تیم باید دست‌کم یک نفر پذیرفته باشد.</EmptyDescription>
              )}
            </>
          ) : match.myState === "joined" ? (
            <EmptyDescription>
              دعوت را پذیرفته‌اید. منتظر می‌مانیم بقیه جواب بدهند یا {hostName} مسابقه را شروع کند. {settingsText(match)}
            </EmptyDescription>
          ) : (
            <EmptyDescription>این دعوت را رد کرده‌اید.</EmptyDescription>
          )}
        </Empty>
      )}

      {(match.status === "declined" || match.status === "cancelled") && (
        <Empty className="py-6">
          <EmptyDescription>
            {match.status === "declined"
              ? "همهٔ اعضای یک تیم دعوت را رد کردند و مسابقه برگزار نمی‌شود."
              : iAmHost
                ? "این مسابقه را لغو کردید."
                : `${hostName} این مسابقه را لغو کرد.`}
          </EmptyDescription>
          <Link href="/moshaere?tab=matches" className={buttonVariants({ variant: "outline" })}>
            بازگشت به مسابقه‌ها
          </Link>
        </Empty>
      )}

      {match.status === "finished" && (
        <Empty className="py-6">
          <EmptyIcon>{!mine || won ? <FaTrophy /> : <FaFlag />}</EmptyIcon>
          <EmptyTitle className={cn(mine && (won ? "text-primary" : "text-destructive"))}>
            {mine ? (won ? "بردید" : "باختید") : "پایان مسابقه"}
          </EmptyTitle>
          <EmptyDescription>{finishedText()}</EmptyDescription>
          <EmptyActions>
            {mine && (
              <Button type="button" disabled={busy} onClick={() => void rematch()}>
                مسابقهٔ دوباره
              </Button>
            )}
            <Link href="/moshaere?tab=matches" className={buttonVariants({ variant: "outline" })}>
              مسابقه‌ها
            </Link>
          </EmptyActions>
        </Empty>
      )}

      {actionError && <FormError>{actionError}</FormError>}

      {moves.length > 0 ? (
        <MoveChain moves={moves} viewer={me} teamOf={teamOf} freshAfter={freshAfter.current} />
      ) : (
        match.status === "active" && (
          <Empty>
            <EmptyDescription>
              {myTurn
                ? "تیم شما آغاز می‌کند؛ هر بیتی می‌تواند اولین بیت باشد."
                : `${teamName(match, match.turnTeam)} اولین بیت را می‌خواند.`}
            </EmptyDescription>
          </Empty>
        )
      )}

      {match.status === "active" && (
        <div className="msh-dock">
          {myTurn ? (
            <>
              <p className="msh-turn-note">نوبت تیم شما؛ هر عضو تیم می‌تواند بیت بخواند.</p>
              <Composer
                required={match.nextLetter}
                sending={sending}
                error={error}
                onEdit={() => setError("")}
                onSend={send}
                assistAvailable={match.assist}
                assist={assist}
                onAssistChange={setAssist}
              />
            </>
          ) : (
            <p className="py-2 text-center text-sm leading-8 text-muted-foreground">
              {match.myState === "left" || !mine ? "مسابقه را تماشا می‌کنید" : "منتظر بیت تیم حریف هستید"}
              {match.nextLetter ? (
                <>
                  ؛ بیت بعدی با <span className={chipClass("strong", "text-sm")}>{match.nextLetter}</span> شروع می‌شود
                </>
              ) : null}
              .
            </p>
          )}
        </div>
      )}

      <Dialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <DialogPopup dir="rtl" showCloseButton={false} className="text-right sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>مسابقه را ترک می‌کنید؟</DialogTitle>
            <DialogDescription>
              {lastOfMyTeam
                ? "شما آخرین عضو تیمتان هستید؛ با رفتن شما تیم شما مسابقه را می‌بازد."
                : "هم‌تیمی‌هایتان به بازی ادامه می‌دهند. تیم شما فقط وقتی می‌بازد که هیچ‌کس در آن نمانده باشد."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter variant="bare">
            <Button type="button" variant="outline" className="h-11" onClick={() => setConfirmLeave(false)}>
              ادامه می‌دهم
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-11"
              disabled={busy}
              onClick={async () => {
                setConfirmLeave(false);
                await run(() => leaveMatch(id));
              }}
            >
              ترک مسابقه
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>,
  );
}

function ViewerGate({ viewer }: { viewer: ViewerState }) {
  return viewer.status === "loading" ? (
    <Empty role="status">
      <EmptyDescription>در حال بارگذاری…</EmptyDescription>
    </Empty>
  ) : (
    <JoinPrompt viewer={viewer} forbidden="" />
  );
}
