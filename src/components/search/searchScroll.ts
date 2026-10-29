import { SCROLL_KEY } from "@/components/search/searchConfig";

// Only restore scroll when the user came back through history, never on a fresh visit.
let lastPopstateAt = 0;
if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    lastPopstateAt = Date.now();
  });
}
export const arrivedViaHistory = () => {
  if (Date.now() - lastPopstateAt < 3000) return true;
  const [navigation] = performance.getEntriesByType?.("navigation") ?? [];
  return (navigation as PerformanceNavigationTiming | undefined)?.type === "back_forward";
};

export const readStoredScroll = (): { href: string; y: number } | null => {
  try {
    const raw = window.sessionStorage.getItem(SCROLL_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};
export const writeStoredScroll = (value: { href: string; y: number } | null) => {
  try {
    if (value) window.sessionStorage.setItem(SCROLL_KEY, JSON.stringify(value));
    else window.sessionStorage.removeItem(SCROLL_KEY);
  } catch {
    // Best-effort only.
  }
};
