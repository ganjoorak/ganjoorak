import { cache } from "react";
import type { PublicProfile } from "@/utils/accountApi";
import { logger } from "@/utils/logger";

// Server components call the accounts service directly instead of going
// through the /api/account rewrite on our own origin.
const ACCOUNTS_API_URL = (process.env.ACCOUNTS_API_URL || "http://127.0.0.1:8787").replace(/\/+$/, "");

const USERNAME_PATTERN = /^[a-z0-9_]{3,32}$/;

/**
 * Null when the account doesn't exist, is private, or the service is down.
 * Cached per request so generateMetadata and the page share one fetch.
 */
export const getPublicProfile = cache(async (rawUsername: string): Promise<PublicProfile | null> => {
  const username = decodeURIComponent(rawUsername).trim().toLowerCase();
  if (!USERNAME_PATTERN.test(username)) {
    return null;
  }
  try {
    const response = await fetch(`${ACCOUNTS_API_URL}/api/account/users/${username}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      if (response.status !== 404) {
        logger.error("Public profile request failed", response.status);
      }
      return null;
    }
    const body = (await response.json()) as { profile: PublicProfile };
    return body.profile;
  } catch (error) {
    logger.error("Public profile request failed", error);
    return null;
  }
});
