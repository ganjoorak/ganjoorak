import { fetchAccount, type AccountUser } from "@/utils/accountApi";

// Who is signed in, asked once and shared. The app has no account context: each page that needs to know
// (the read tracker, the quote menu, the stories row) goes through here instead of calling /me again.

export interface AccountSession {
  user: AccountUser | null;
  /**
   * Whether today already counted for the streak when the page learned who the reader is; kept up to date
   * by the read tracker. null while unknown (signed out, or the account answer had no progress).
   */
  streakToday: boolean | null;
}

const SIGNED_IN_TTL_MS = 5 * 60_000;
// Short, so a sign-in on /login is noticed within moments.
const SIGNED_OUT_TTL_MS = 10_000;

let cached: { at: number; ttl: number; session: AccountSession } | null = null;
let pending: Promise<AccountSession> | null = null;

const signedOut: AccountSession = { user: null, streakToday: null };

export const peekAccountSession = () => (cached && Date.now() - cached.at < cached.ttl ? cached.session : null);

/** Forget the answer, e.g. after sign-in or sign-out. */
export const invalidateAccountSession = () => {
  cached = null;
};

export const getAccountSession = (): Promise<AccountSession> => {
  const fresh = peekAccountSession();
  if (fresh) return Promise.resolve(fresh);
  if (pending) return pending;
  pending = fetchAccount()
    .then((account) => {
      const session: AccountSession = { user: account.user, streakToday: account.progress?.streak?.today ?? null };
      cached = { at: Date.now(), ttl: SIGNED_IN_TTL_MS, session };
      return session;
    })
    .catch(() => {
      // 401 (signed out) or the service is down: either way nothing account-related happens.
      cached = { at: Date.now(), ttl: SIGNED_OUT_TTL_MS, session: signedOut };
      return signedOut;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
};

const listeners = new Set<(session: AccountSession) => void>();

/** Called when the cached account changes in place (see setAccountSessionUser). */
export const subscribeAccountSession = (listener: (session: AccountSession) => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Swaps in a fresher copy of the signed-in user (after a profile or appearance edit, an avatar upload) so the
 * menu header, stories and the rest show it without another /me round trip.
 */
export const setAccountSessionUser = (user: AccountUser) => {
  const base = cached?.session ?? { user: null, streakToday: null };
  const session = { ...base, user };
  cached = { at: cached?.at ?? Date.now(), ttl: cached?.ttl ?? SIGNED_IN_TTL_MS, session };
  listeners.forEach((listener) => listener(session));
};

/** Records that today now counts, so the next read doesn't announce the streak again. */
export const markStreakToday = () => {
  if (cached?.session.user) {
    cached.session = { ...cached.session, streakToday: true };
  }
};
