"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const PwaInstallPrompt = () => {
  const [promptEvent, setPromptEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const dismissed = window.localStorage.getItem("ganjoorak:pwa-install-dismissed");
    if (dismissed === "1") {
      return;
    }

    // Skip the first visit: it already opens the interests dialog.
    if (window.localStorage.getItem("ganjoorak:visited") !== "1") {
      window.localStorage.setItem("ganjoorak:visited", "1");
      return;
    }

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
      setIsVisible(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  if (!isVisible || !promptEvent) {
    return null;
  }

  return (
    <Card role="dialog" aria-label="نصب گنجورک" className="pwa-install-banner gap-3 px-4 shadow-lg">
      <p className="text-sm leading-7">گنجورک را روی صفحهٔ اصلی نصب کنید تا سریع‌تر و آفلاین‌تر در دسترس باشد.</p>
      <div className="pwa-install-actions">
        <Button
          className="flex-1"
          onClick={async () => {
            await promptEvent.prompt();
            await promptEvent.userChoice;
            setIsVisible(false);
            setPromptEvent(null);
          }}
        >
          نصب
        </Button>
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => {
            window.localStorage.setItem("ganjoorak:pwa-install-dismissed", "1");
            setIsVisible(false);
            setPromptEvent(null);
          }}
        >
          بعداً
        </Button>
      </div>
    </Card>
  );
};

export default PwaInstallPrompt;
