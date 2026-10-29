"use client";

import { useCallback, useEffect, useState } from "react";
import AppPage from "@/components/AppPage";
import MatchesTab, { type MatchList } from "@/components/moshaere/MatchesTab";
import PublicRoom from "@/components/moshaere/PublicRoom";
import { errorText, isAuthError, useViewer, useVisibleInterval } from "@/components/moshaere/shared";
import { Tabs, TabsIndicator, TabsList, TabsTab } from "@/components/ui/tabs";
import { fetchMatches } from "@/utils/moshaereApi";
import { formatPersianNumber } from "@/utils/searchText";
import "../../styles/Moshaere.css";

export type MoshaereTab = "public" | "matches";

/** مشاعره: the public room and my team matches. */
export default function MoshaerePage({ initialTab }: { initialTab: MoshaereTab }) {
  const viewer = useViewer();
  const [tab, setTab] = useState<MoshaereTab>(initialTab);
  const [list, setList] = useState<MatchList | null>(null);
  const [error, setError] = useState("");
  const signedIn = viewer.status === "in";

  const reload = useCallback(async () => {
    try {
      setList(await fetchMatches());
      setError("");
    } catch (caught) {
      if (!isAuthError(caught)) setError(errorText(caught));
    }
  }, []);

  useEffect(() => {
    if (signedIn) void reload();
  }, [signedIn, reload]);

  // The badges on the tab keep up in the background, faster while the list is on screen.
  useVisibleInterval(reload, tab === "matches" ? 5000 : 15000, signedIn);

  const waiting = list ? list.invites + list.yourTurn : 0;

  return (
    <AppPage
      title="مشاعره"
      width="narrow"
      className={`msh-page msh-page--${tab}`}
      subtitle="هر بیت با آخرین حرف بیت پیش از خودش شروع می‌شود. در زنجیرهٔ همگانی شرکت کنید یا دوستانتان را به مسابقه بخوانید."
      headerExtra={
        <Tabs value={tab} onValueChange={(value) => setTab(value as MoshaereTab)}>
          <TabsList className="relative" aria-label="نوع مشاعره">
            <TabsIndicator />
            <TabsTab value="public" className="relative data-active:bg-transparent data-active:shadow-none">
              همگانی
            </TabsTab>
            <TabsTab value="matches" className="relative data-active:bg-transparent data-active:shadow-none">
              مسابقه‌ها
              {waiting > 0 && (
                <span
                  className="follow-tab-count"
                  aria-label={`${formatPersianNumber(waiting)} مورد در انتظار شما`}
                >
                  {formatPersianNumber(waiting)}
                </span>
              )}
            </TabsTab>
          </TabsList>
        </Tabs>
      }
    >
      {tab === "public" ? (
        <PublicRoom viewer={viewer} />
      ) : (
        <MatchesTab viewer={viewer} list={list} error={error} onReload={reload} />
      )}
    </AppPage>
  );
}
