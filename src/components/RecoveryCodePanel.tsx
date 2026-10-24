"use client";

import { useState } from "react";
import { FaCheck, FaCopy } from "react-icons/fa";
import { Button } from "@/components/ui/button";

/**
 * Shows a freshly issued recovery code: the only time the user sees it (the service keeps just a hash).
 * The continue button waits until they confirm they kept it.
 */
export default function RecoveryCodePanel({
  code,
  doneLabel,
  onDone,
}: {
  code: string;
  doneLabel: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="recovery-panel">
      <p className="recovery-panel-text">
        اگر گذرواژه را فراموش کنید، با نام کاربری و همین کد می‌توانید گذرواژهٔ تازه بگذارید. این کد
        فقط همین یک بار نشان داده می‌شود؛ آن را جایی امن نگه دارید.
      </p>
      <div className="recovery-code-row">
        <code className="recovery-code" dir="ltr" aria-label="کد بازیابی">
          {code}
        </code>
        <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
          {copied ? <FaCheck aria-hidden="true" /> : <FaCopy aria-hidden="true" />}
          {copied ? "کپی شد" : "کپی"}
        </Button>
      </div>
      <label className="recovery-confirm">
        <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
        کد را جایی امن نگه داشتم
      </label>
      <Button type="button" size="lg" className="auth-submit" disabled={!saved} onClick={onDone}>
        {doneLabel}
      </Button>
    </div>
  );
}
