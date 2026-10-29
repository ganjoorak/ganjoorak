"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FaChevronDown, FaChevronLeft, FaFeatherAlt } from "react-icons/fa";
import Composer from "@/components/moshaere/Composer";
import MoveChain from "@/components/moshaere/MoveChain";
import {
  errorText,
  lastId,
  mergeMoves,
  nearBottom,
  scrollToBottom,
  useVisibleInterval,
  usePersistedFlag,
  type ViewerState,
} from "@/components/moshaere/shared";
import ProfileAvatar from "@/components/ProfileAvatar";
import { Button, buttonVariants } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyIcon } from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { AccountError, publicProfilePath } from "@/utils/accountApi";
import {
  fetchPublicRoom,
  postPublicMove,
  type MoshaereLeader,
  type MoshaereMove,
  type VerseInput,
} from "@/utils/moshaereApi";
import { formatPersianNumber } from "@/utils/searchText";

const POLL_MS = 4000;
const ASSIST_KEY = "ganjoorak:moshaere:public-assist";

const LEADERS_SHOWN = 3;

function Leaders({ leaders }: { leaders: MoshaereLeader[] }) {
  const [all, setAll] = useState(false);
  if (leaders.length === 0) return null;
  const shown = all ? leaders : leaders.slice(0, LEADERS_SHOWN);
  return (
    <section className="app-section" aria-labelledby="msh-leaders-title">
      <h2 id="msh-leaders-title" className="app-section-title">
        پرکارهای هفته
      </h2>
      <ul className="app-list">
        {shown.map((leader, index) => (
          <li key={leader.username}>
            <Link href={publicProfilePath(leader.username)} prefetch={false} className="app-row follow-link">
              <span className="w-4 shrink-0 text-center text-xs font-bold text-muted-foreground">
                {formatPersianNumber(index + 1)}
              </span>
              <ProfileAvatar username={leader.username} avatar={leader.avatar} className="follow-avatar" decorative />
              <span className="app-row-body">
                <span className="app-row-title">{leader.displayName}</span>
                <span className="app-row-meta">{formatPersianNumber(leader.count)} بیت در هفتهٔ گذشته</span>
              </span>
              <FaChevronLeft className="app-row-chevron" aria-hidden="true" />
            </Link>
          </li>
        ))}
        {leaders.length > LEADERS_SHOWN && (
          <li>
            <button type="button" className="app-row" aria-expanded={all} onClick={() => setAll(!all)}>
              <span className="app-row-body">
                <span className="app-row-meta">{all ? "نمایش کمتر" : `نمایش همهٔ ${formatPersianNumber(leaders.length)} نفر`}</span>
              </span>
              <FaChevronDown className={cn("app-row-chevron transition-transform", all && "rotate-180")} aria-hidden="true" />
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}

/** Prompt that stands in for the composer when the visitor cannot take part. */
export function JoinPrompt({
  viewer,
  forbidden,
  docked = false,
}: {
  viewer: ViewerState;
  /** The server's 403 message, when it refused a post. */
  forbidden: string;
  /** Inside the sticky dock: no dashed card, just the message and its action. */
  docked?: boolean;
}) {
  if (viewer.status === "loading") return null;
  const className = docked ? "gap-2 border-0 bg-transparent px-0 py-1" : undefined;
  if (viewer.status === "out") {
    return (
      <Empty className={className}>
        {!docked && (
          <EmptyIcon>
            <FaFeatherAlt />
          </EmptyIcon>
        )}
        <EmptyDescription>برای شرکت در مشاعره وارد شوید. خواندن بیت‌ها برای همه آزاد است.</EmptyDescription>
        <Link href="/login" className={buttonVariants({ size: "lg" })}>
          برای شرکت وارد شوید
        </Link>
      </Empty>
    );
  }
  return (
    <Empty className={className}>
      {!docked && (
        <EmptyIcon>
          <FaFeatherAlt />
        </EmptyIcon>
      )}
      <EmptyDescription>{forbidden || "برای مشاعرهٔ عمومی باید نمایه‌تان عمومی باشد."}</EmptyDescription>
      <Link href="/profile/settings" className={buttonVariants({ size: "lg", variant: "outline" })}>
        تنظیمات نمایه
      </Link>
    </Empty>
  );
}

/** The shared chain everyone with a public profile can extend. */
export default function PublicRoom({ viewer }: { viewer: ViewerState }) {
  const [moves, setMoves] = useState<MoshaereMove[]>([]);
  const [leaders, setLeaders] = useState<MoshaereLeader[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [forbidden, setForbidden] = useState("");
  const [assist, setAssist] = usePersistedFlag(ASSIST_KEY);

  const movesRef = useRef<MoshaereMove[]>([]);
  movesRef.current = moves;
  const freshAfter = useRef(Infinity);
  const pendingScroll = useRef<"auto" | "smooth" | null>(null);

  const applyMoves = useCallback((incoming: MoshaereMove[], scroll: "auto" | "smooth" | "ifNear") => {
    if (scroll === "ifNear") {
      if (incoming.length > 0 && nearBottom()) pendingScroll.current = "smooth";
    } else {
      pendingScroll.current = scroll;
    }
    setMoves((current) => mergeMoves(current, incoming));
  }, []);

  const load = useCallback(() => {
    setStatus("loading");
    fetchPublicRoom()
      .then((room) => {
        freshAfter.current = lastId(room.moves);
        setLeaders(room.leaders);
        applyMoves(room.moves, "auto");
        setStatus("ready");
      })
      .catch((caught) => {
        setLoadError(errorText(caught));
        setStatus("error");
      });
  }, [applyMoves]);

  useEffect(load, [load]);

  const poll = useCallback(async () => {
    const room = await fetchPublicRoom(lastId(movesRef.current) || undefined);
    setLeaders(room.leaders);
    applyMoves(room.moves, "ifNear");
  }, [applyMoves]);

  useVisibleInterval(poll, POLL_MS, status === "ready");

  useEffect(() => {
    if (!pendingScroll.current) return;
    const smooth = pendingScroll.current === "smooth";
    pendingScroll.current = null;
    scrollToBottom(smooth);
  }, [moves]);

  const newest = moves[moves.length - 1];
  const nextLetter = newest?.lastLetter ?? "";
  const me = viewer.status === "in" ? viewer.user.username : "";
  const canPost = viewer.status === "in" && viewer.user.isPublic && !forbidden;
  // The room allows no two moves in a row from one person.
  const lockedReason =
    me && newest?.username === me ? "بیت شما آخرین بیت است. صبر کنید کس دیگری بیتی بخواند." : "";

  const send = async (verse: VerseInput) => {
    setSending(true);
    setError("");
    try {
      const { move } = await postPublicMove(verse, lastId(movesRef.current));
      applyMoves([move], "smooth");
      return true;
    } catch (caught) {
      if (caught instanceof AccountError && caught.status === 403) {
        setForbidden(caught.message);
      } else {
        if (caught instanceof AccountError && caught.status === 409) {
          // Someone was faster (or you spoke last): catch up so the letter is the real one.
          await poll().catch(() => undefined);
        }
        setError(errorText(caught));
      }
      return false;
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="msh-room">
      <Leaders leaders={leaders} />

      {status === "loading" && (
        <Empty role="status">
          <EmptyDescription>در حال بارگذاری…</EmptyDescription>
        </Empty>
      )}

      {status === "error" && (
        <Empty>
          <EmptyDescription>{loadError}</EmptyDescription>
          <Button type="button" variant="outline" onClick={load}>
            تلاش دوباره
          </Button>
        </Empty>
      )}

      {status === "ready" && moves.length === 0 && (
        <Empty>
          <EmptyIcon>
            <FaFeatherAlt />
          </EmptyIcon>
          <EmptyDescription>هنوز بیتی گفته نشده است. اولین بیت را شما بخوانید.</EmptyDescription>
        </Empty>
      )}

      {moves.length > 0 && (
        <MoveChain moves={moves} viewer={me} freshAfter={freshAfter.current} />
      )}

      {status === "ready" && (
        <div className="msh-dock">
          {canPost ? (
            <Composer
              required={nextLetter}
              sending={sending}
              error={error}
              onEdit={() => setError("")}
              onSend={send}
              assistAvailable
              assist={assist}
              onAssistChange={setAssist}
              lockedReason={lockedReason}
            />
          ) : (
            <JoinPrompt viewer={viewer} forbidden={forbidden} docked />
          )}
        </div>
      )}
    </div>
  );
}
