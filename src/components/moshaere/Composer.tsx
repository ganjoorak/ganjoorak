"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { FaPaperPlane, FaSearch } from "react-icons/fa";
import SearchHelper from "@/components/moshaere/SearchHelper";
import { chipClass } from "@/components/moshaere/shared";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { Toggle } from "@/components/ui/toggle";
import { checkVerse, firstLetter, lastLetter, MAX_VERSE_LINES } from "@/utils/moshaereLetters";
import type { VerseInput } from "@/utils/moshaereApi";
import "@/styles/searchStyles";
import "../../styles/Moshaere.css";

/**
 * The docked composer: chips for the letter the verse must start with, a two-line field (two
 * mesras) with the send button on the inline-start side (the right, in RTL); optionally the
 * search helper. `onSend` resolves to true when the verse was accepted
 * (the draft is then cleared); on failure the draft stays so a lost race costs nothing.
 */
export default function Composer({
  required,
  sending,
  error,
  onEdit,
  onSend,
  assistAvailable,
  assist,
  onAssistChange,
  lockedReason = "",
}: {
  required: string;
  sending: boolean;
  /** The server's last answer, in Persian. */
  error: string;
  onEdit: () => void;
  onSend: (verse: VerseInput) => Promise<boolean>;
  assistAvailable: boolean;
  assist: boolean;
  onAssistChange: (value: boolean) => void;
  /** Why sending is paused right now (e.g. you spoke last); the draft stays editable. */
  lockedReason?: string;
}) {
  const [draft, setDraft] = useState("");
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const lines = draft.split("\n");
  const typed = firstLetter(lines);
  const wrongStart = Boolean(required && typed && typed !== required);
  const issue = checkVerse(lines, required);
  const ending = issue === null || issue === "tooShort" ? lastLetter(lines) : "";

  const updateDraft = (value: string) => {
    const clean = value.replaceAll("\r", "").split("\n").slice(0, MAX_VERSE_LINES).join("\n");
    setDraft(clean);
    onEdit();
  };

  const send = async () => {
    if (sending || issue !== null || lockedReason) return;
    const accepted = await onSend({ lines: lines.map((line) => line.trim()).filter(Boolean) });
    if (accepted) setDraft("");
    else areaRef.current?.focus({ preventScroll: true });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      void send();
    } else if (draft.includes("\n")) {
      // Two mesras make a verse: no third line.
      event.preventDefault();
    }
  };

  const pickVerse = async (verse: VerseInput) => {
    await onSend(verse);
  };

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={chipClass(wrongStart ? "negative" : "strong", "py-1")}
          aria-label={required ? `بیت شما باید با «${required}» شروع شود` : undefined}
        >
          {required ? (
            <>
              حرف آغاز <strong className="text-sm">{required}</strong>
            </>
          ) : (
            "هر بیتی می‌تواند آغاز باشد"
          )}
        </span>
        {ending && (
          <span className={chipClass("muted", "py-1")}>
            حرف بعدی <strong className="text-sm text-foreground">{ending}</strong>
          </span>
        )}
        {assistAvailable && (
          <Toggle
            variant="outline"
            size="sm"
            className="ms-auto rounded-full px-3"
            pressed={assist}
            onPressedChange={onAssistChange}
          >
            <FaSearch aria-hidden="true" />
            جست‌وجو
          </Toggle>
        )}
      </div>

      {assistAvailable && assist && (
        <SearchHelper required={required} busy={sending || Boolean(lockedReason)} onPick={pickVerse} />
      )}

      {wrongStart && (
        <FormError role="status" aria-live="polite">
          بیت شما با «{typed}» شروع شده؛ باید با «{required}» شروع شود.
        </FormError>
      )}
      {issue === "tooLong" && (
        <FormError role="status" aria-live="polite">
          هر مصراع حداکثر ۱۲۰ نویسه می‌تواند باشد.
        </FormError>
      )}
      {lockedReason && (
        <p className="px-1 text-sm leading-7 text-muted-foreground" role="status">
          {lockedReason}
        </p>
      )}
      {error && <FormError>{error}</FormError>}

      <div className="search-field msh-field">
        <Button
          type="button"
          size="icon-lg"
          className="mb-0.5 shrink-0 rounded-full"
          disabled={sending || issue !== null || Boolean(lockedReason)}
          onClick={() => void send()}
          aria-label="ارسال بیت"
        >
          <FaPaperPlane className="-scale-x-100" aria-hidden="true" />
        </Button>
        <textarea
          ref={areaRef}
          className="min-w-0 flex-1 resize-none border-0 bg-transparent py-1 text-base leading-8 text-foreground outline-none placeholder:text-muted-foreground"
          dir="rtl"
          rows={2}
          value={draft}
          onChange={(event) => updateDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={"مصراع اول\nمصراع دوم"}
          aria-label="بیت شما؛ هر مصراع در یک خط"
          aria-invalid={wrongStart || undefined}
          enterKeyHint="enter"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
    </div>
  );
}
