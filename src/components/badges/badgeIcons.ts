import { Crown, Flame, Moon, Sprout, Star, type LucideIcon } from "lucide-react";
import type { BadgeIcon } from "@/utils/progressApi";

/** Badge `icon` keys from the accounts service, mapped to this client's icon set. */
export const BADGE_ICONS: Record<BadgeIcon, LucideIcon> = {
  sprout: Sprout,
  flame: Flame,
  moon: Moon,
  star: Star,
  crown: Crown,
};

/** Unknown keys (a newer server) fall back to a star. */
export const badgeIcon = (icon: string): LucideIcon => BADGE_ICONS[icon as BadgeIcon] ?? Star;
