"use client";

import { useEffect, useState } from "react";
import {
  getAccountSession,
  peekAccountSession,
  subscribeAccountSession,
  type AccountSession,
} from "@/utils/accountSession";

/**
 * The signed-in account, or null signed out. `isLoading` is true until the first answer, so callers can
 * tell "not yet known" from "signed out". Re-asks when the tab comes back after the answer went stale.
 */
export function useAccountSession() {
  const [session, setSession] = useState<AccountSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getAccountSession().then((next) => {
        if (cancelled) return;
        setSession(next);
        setIsLoading(false);
      });
    const cachedSession = peekAccountSession();
    if (cachedSession) {
      setSession(cachedSession);
      setIsLoading(false);
    } else {
      load();
    }
    const onVisible = () => {
      if (document.visibilityState === "visible" && !peekAccountSession()) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    const unsubscribe = subscribeAccountSession((next) => {
      setSession(next);
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return { user: session?.user ?? null, role: session?.role ?? "", isSignedIn: Boolean(session?.user), isLoading };
}
