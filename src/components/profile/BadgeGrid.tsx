import { badgeIcon } from "@/components/badges/badgeIcons";
import { formatDate } from "@/components/profile/profileFormat";
import type { Badge } from "@/utils/progressApi";
import "../../styles/ProfileSections.css";

/**
 * Badges as an app list. Earned ones carry the date; `locked` (the owner's view) are catalog
 * badges not earned yet, dimmed, with what they ask for.
 */
export function BadgeGrid({ earned, locked = [] }: { earned: Badge[]; locked?: Badge[] }) {
  return (
    <ul className="app-list badge-list">
      {earned.map((badge) => {
        const Icon = badgeIcon(badge.icon);
        return (
          <li key={badge.key} data-earned="true" data-tier={badge.tier}>
            <div className="app-row">
              <span className="app-row-icon" aria-hidden="true">
                <Icon />
              </span>
              <span className="app-row-body">
                <span className="app-row-title">{badge.title}</span>
                <span className="app-row-meta">{badge.description}</span>
              </span>
              <span className="app-row-meta badge-date">{formatDate(badge.earnedAt)}</span>
            </div>
          </li>
        );
      })}
      {locked.map((badge) => {
        const Icon = badgeIcon(badge.icon);
        return (
          <li key={badge.key} data-earned="false">
            <div className="app-row">
              <span className="app-row-icon" aria-hidden="true">
                <Icon />
              </span>
              <span className="app-row-body">
                <span className="app-row-title">{badge.title}</span>
                <span className="app-row-meta">{badge.description}</span>
              </span>
              <span className="app-row-meta badge-date">هنوز نگرفته‌اید</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
