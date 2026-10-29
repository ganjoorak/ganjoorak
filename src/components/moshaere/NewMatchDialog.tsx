"use client";

import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { FaPlus, FaTimes } from "react-icons/fa";
import { Segmented } from "@/components/search/Segmented";
import { TURN_LABELS, errorText, useViewer } from "@/components/moshaere/shared";
import ProfileAvatar from "@/components/ProfileAvatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-error";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { formatPersianNumber } from "@/utils/searchText";
import { fetchFollowList, type FollowedUser } from "@/utils/accountApi";
import { TURN_SECONDS, createMatch, type Match, type TurnSeconds } from "@/utils/moshaereApi";
import "@/styles/SettingsSheet.css";
import "@/styles/searchStyles";

const cleanUsername = (value: string) => value.trim().replace(/^@/, "").toLowerCase();

const MAX_ALLIES = 4;
const MAX_OPPONENTS = 5;

type TeamKey = "allies" | "opponents";

const TEAMS: Record<TeamKey, { title: string; max: number; placeholder: string }> = {
  allies: { title: "هم‌تیمی‌ها", max: MAX_ALLIES, placeholder: "نام کاربری هم‌تیمی (اختیاری)" },
  opponents: { title: "حریف‌ها", max: MAX_OPPONENTS, placeholder: "نام کاربری حریف" },
};

/** One team's picker: its chosen members as removable chips, and a field to add more by username. */
function TeamPicker({
  team,
  members,
  draft,
  directory,
  suggestions,
  showSuggestions,
  host,
  onDraft,
  onAdd,
  onRemove,
  onFocus,
}: {
  team: TeamKey;
  members: string[];
  draft: string;
  directory: Map<string, FollowedUser>;
  suggestions: FollowedUser[];
  showSuggestions: boolean;
  host?: { username: string; displayName: string; avatar: string };
  onDraft: (value: string) => void;
  onAdd: (username: string) => boolean;
  onRemove: (username: string) => void;
  onFocus: () => void;
}) {
  const { title, max, placeholder } = TEAMS[team];
  const full = members.length >= max;

  const commit = () => {
    if (onAdd(draft)) onDraft("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    // Enter adds the name; sending the invitation is the button's job.
    event.preventDefault();
    commit();
  };

  return (
    <section className="settings-group">
      <h3 className="settings-group-title">
        {title}
        <span className="ms-2 font-normal">
          {formatPersianNumber(members.length)} از {formatPersianNumber(max)}
        </span>
      </h3>
      <div className="settings-group-card">
        <div className="settings-group-block">
          <ul className="flex flex-wrap gap-2" aria-label={title}>
            {host && (
              <li>
                <span className="search-chip is-small is-active ps-1" style={{ cursor: "default" }}>
                  <ProfileAvatar username={host.username} avatar={host.avatar} className="size-6!" decorative />
                  شما
                </span>
              </li>
            )}
            {members.map((username) => {
              const known = directory.get(username);
              return (
                <li key={username}>
                  <span className="search-chip is-small is-active ps-1 pe-1" style={{ cursor: "default" }}>
                    <ProfileAvatar username={username} avatar={known?.avatar} className="size-6!" decorative />
                    {known?.displayName ?? <bdi dir="ltr">{username}</bdi>}
                    <button
                      type="button"
                      className="msh-chip-remove"
                      aria-label={`حذف ${known?.displayName ?? username}`}
                      onClick={() => onRemove(username)}
                    >
                      <FaTimes aria-hidden="true" />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="flex gap-2">
            <Input
              dir="ltr"
              value={draft}
              disabled={full}
              onChange={(event) => {
                const value = event.target.value;
                // A space or a comma ends a name, like Enter does.
                if (/[\s,،]$/.test(value) && value.trim()) {
                  if (onAdd(value)) onDraft("");
                  else onDraft(value.trim());
                } else onDraft(value);
              }}
              onKeyDown={onKeyDown}
              onFocus={onFocus}
              placeholder={full ? "ظرفیت تیم پر است" : placeholder}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="done"
              aria-label={placeholder}
              className="text-left"
            />
            <Button
              type="button"
              variant="outline"
              size="icon-lg"
              disabled={full || !draft.trim()}
              onClick={commit}
              aria-label={`افزودن به ${title}`}
            >
              <FaPlus aria-hidden="true" />
            </Button>
          </div>
          {showSuggestions && !full && suggestions.length > 0 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="دنبال‌شده‌ها">
              {suggestions.map((user) => (
                <button
                  key={user.username}
                  type="button"
                  className="search-chip is-small ps-1"
                  onClick={() => onAdd(user.username)}
                >
                  <ProfileAvatar username={user.username} avatar={user.avatar} className="size-6!" decorative />
                  {user.displayName}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * «مسابقهٔ تازه»: two teams of usernames («هم‌تیمی‌ها» 0-4 besides me, «حریف‌ها» 1-5; one opponent is a
 * 1 vs 1), the turn time and whether search is allowed.
 */
export default function NewMatchDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const viewer = useViewer();
  const me = viewer.status === "in" ? viewer.user : null;
  const [members, setMembers] = useState<Record<TeamKey, string[]>>({ allies: [], opponents: [] });
  const [drafts, setDrafts] = useState<Record<TeamKey, string>>({ allies: "", opponents: "" });
  const [focused, setFocused] = useState<TeamKey>("opponents");
  const [turnSeconds, setTurnSeconds] = useState<TurnSeconds>(60);
  const [assist, setAssist] = useState(true);
  const [following, setFollowing] = useState<FollowedUser[]>([]);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchFollowList("following")
      .then((users) => !cancelled && setFollowing(users))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const directory = new Map(following.map((user) => [user.username, user]));
  const chosen = new Set([...members.allies, ...members.opponents]);

  /** Adds a username to a team, or explains why not. */
  const add = (team: TeamKey, raw: string, lists = members) => {
    const username = cleanUsername(raw);
    if (!username) return false;
    if (username === me?.username) {
      setError("خودتان را نمی‌توانید اضافه کنید؛ شما همیشه در تیم خودتان هستید.");
      return false;
    }
    if (lists.allies.includes(username) || lists.opponents.includes(username)) {
      setError(`«${username}» را قبلاً اضافه کرده‌اید.`);
      return false;
    }
    if (lists[team].length >= TEAMS[team].max) {
      setError(`هر تیم حداکثر ${formatPersianNumber(MAX_ALLIES + 1)} نفر است.`);
      return false;
    }
    setError("");
    setMembers({ ...lists, [team]: [...lists[team], username] });
    return true;
  };

  const suggestionsFor = (team: TeamKey) => {
    const text = drafts[team].trim();
    const name = cleanUsername(text);
    return following
      .filter((user) => user.username !== me?.username && !chosen.has(user.username))
      .filter((user) => !name || user.username.includes(name) || user.displayName.includes(text))
      .slice(0, 8);
  };

  const pendingOpponent = cleanUsername(drafts.opponents);
  const canSend = members.opponents.length > 0 || Boolean(pendingOpponent);
  const alliesCount = members.allies.length + 1 + (cleanUsername(drafts.allies) ? 1 : 0);
  const opponentsCount = members.opponents.length + (pendingOpponent ? 1 : 0);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSend || sending) return;
    // A name typed but not yet added still counts.
    let lists = members;
    for (const team of ["allies", "opponents"] as const) {
      const username = cleanUsername(drafts[team]);
      if (!username) continue;
      if (username === me?.username || lists.allies.includes(username) || lists.opponents.includes(username)) {
        setError(
          username === me?.username ? "خودتان را نمی‌توانید اضافه کنید." : `«${username}» را قبلاً اضافه کرده‌اید.`,
        );
        return;
      }
      lists = { ...lists, [team]: [...lists[team], username] };
    }
    if (lists.opponents.length === 0 || lists.opponents.length > MAX_OPPONENTS || lists.allies.length > MAX_ALLIES) {
      setError("اندازهٔ تیم‌ها درست نیست.");
      return;
    }
    setSending(true);
    setError("");
    try {
      const match: Match = await createMatch({
        opponents: lists.opponents,
        allies: lists.allies,
        assist,
        turnSeconds,
      });
      router.push(`/moshaere/${match.id}`);
    } catch (caught) {
      setError(errorText(caught));
      setSending(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup dir="rtl" showCloseButton={false} className="settings-sheet">
        <form onSubmit={submit} className="contents">
          <DialogHeader className="settings-sheet-header">
            <DialogTitle>مسابقهٔ تازه</DialogTitle>
            <Button type="button" variant="ghost" size="icon-lg" onClick={onClose} aria-label="بستن">
              <FaTimes />
            </Button>
          </DialogHeader>
          <DialogPanel className="settings-sheet-body">
            <div className="settings-sheet-groups">
              <p className="px-1 text-sm leading-7 text-muted-foreground">
                برای مسابقهٔ رودررو فقط یک حریف اضافه کنید. برای مسابقهٔ تیمی، هم‌تیمی‌ها و چند حریف را هم بیاورید؛
                نوبت‌ها بین دو تیم می‌چرخد و هر عضو تیم می‌تواند جواب بدهد.
              </p>

              <TeamPicker
                team="opponents"
                members={members.opponents}
                draft={drafts.opponents}
                directory={directory}
                suggestions={suggestionsFor("opponents")}
                showSuggestions={focused === "opponents"}
                onDraft={(value) => {
                  setDrafts((current) => ({ ...current, opponents: value }));
                  setError("");
                }}
                onAdd={(raw) => add("opponents", raw)}
                onRemove={(username) =>
                  setMembers((current) => ({ ...current, opponents: current.opponents.filter((u) => u !== username) }))
                }
                onFocus={() => setFocused("opponents")}
              />

              <TeamPicker
                team="allies"
                members={members.allies}
                draft={drafts.allies}
                directory={directory}
                suggestions={suggestionsFor("allies")}
                showSuggestions={focused === "allies"}
                host={me ? { username: me.username, displayName: me.displayName, avatar: me.avatar } : undefined}
                onDraft={(value) => {
                  setDrafts((current) => ({ ...current, allies: value }));
                  setError("");
                }}
                onAdd={(raw) => add("allies", raw)}
                onRemove={(username) =>
                  setMembers((current) => ({ ...current, allies: current.allies.filter((u) => u !== username) }))
                }
                onFocus={() => setFocused("allies")}
              />

              <p className="px-1 text-sm font-semibold" aria-live="polite">
                {formatPersianNumber(alliesCount)} در برابر {formatPersianNumber(opponentsCount)}
                {alliesCount === 1 && opponentsCount === 1 && (
                  <span className="ms-2 font-normal text-muted-foreground">مسابقهٔ رودررو</span>
                )}
              </p>

              <section className="settings-group">
                <h3 className="settings-group-title">زمان هر نوبت</h3>
                <div className="settings-group-card">
                  <div className="settings-group-block">
                    <Segmented
                      label="زمان هر نوبت"
                      options={TURN_SECONDS.map((seconds) => ({ value: String(seconds), label: TURN_LABELS[seconds] }))}
                      value={String(turnSeconds)}
                      onChange={(value) => setTurnSeconds(Number(value) as TurnSeconds)}
                    />
                  </div>
                </div>
              </section>

              <section className="settings-group">
                <h3 className="settings-group-title">قوانین</h3>
                <div className="settings-group-card">
                  <label className="settings-row">
                    <span className="settings-row-text">
                      <span>جست‌وجو</span>
                      <small>اگر خاموش باشد، هیچ‌کس در مسابقه نمی‌تواند از جست‌وجو استفاده کند.</small>
                    </span>
                    <Switch checked={assist} onCheckedChange={setAssist} />
                  </label>
                </div>
              </section>

              {error && <FormError>{error}</FormError>}
            </div>
          </DialogPanel>
          <DialogFooter className="settings-sheet-footer">
            <Button type="button" variant="outline" size="lg" onClick={onClose}>
              انصراف
            </Button>
            <Button type="submit" size="lg" loading={sending} disabled={!canSend}>
              {sending ? "در حال ارسال…" : "ارسال دعوت"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
