import ProfileAvatar from "@/components/ProfileAvatar";
import { cn } from "@/lib/utils";
import type { MatchTeam } from "@/utils/moshaereApi";
import { formatPersianNumber } from "@/utils/searchText";
import "../../styles/Moshaere.css";

const MAX_SHOWN = 3;

/** A team as overlapping avatars; players who have not (or no longer) joined fade out. */
export default function TeamStack({ team, className }: { team: MatchTeam; className?: string }) {
  const players = team.players.filter((player) => player.state !== "declined");
  const shown = players.length > MAX_SHOWN ? players.slice(0, MAX_SHOWN - 1) : players;
  const hidden = players.length - shown.length;
  return (
    <span className={cn("msh-stack", className)} aria-hidden="true">
      {shown.map((player) => (
        <ProfileAvatar
          key={player.username}
          username={player.username}
          avatar={player.avatar}
          className={cn("msh-stack-item", player.state !== "joined" && "is-away")}
          decorative
        />
      ))}
      {hidden > 0 && <span className="msh-stack-item msh-stack-more">+{formatPersianNumber(hidden)}</span>}
    </span>
  );
}
