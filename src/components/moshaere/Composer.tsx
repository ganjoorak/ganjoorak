"use client";

import { useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { ArrowUp } from "lucide-react";
import { FaSearch } from "react-icons/fa";
import SearchHelper from "@/components/moshaere/SearchHelper";
import { chipClass } from "@/components/moshaere/shared";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { Toggle } from "@/components/ui/toggle";
import { checkVerse, firstLetter, lastLetter } from "@/utils/moshaereLetters";
import type { VerseInput } from "@/utils/moshaereApi";
import "@/styles/searchStyles";
import "../../styles/Moshaere.css";

/**
 * The docked composer: chips for the letter the verse must start with, a card with one input per
 * mesra and the send button on the inline-start side (the right, in RTL); optionally the
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
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const firstRef = useRef<HTMLTextAreaElement>(null);
  const secondRef = useRef<HTMLTextAreaElement>(null);

  // A long mesra wraps instead of being clipped, so each field grows with its text.
  useLayoutEffect(() => {
    for (const field of [firstRef.current, secondRef.current]) {
      if (!field) continue;
      field.style.height = "auto";
      field.style.height = `${field.scrollHeight}px`;
    }
  }, [first, second]);

  const lines = [first, second].filter((line) => line.trim());
  const typed = lines.length > 0 ? firstLetter(lines) : "";
  const wrongStart = Boolean(required && typed && typed !== required);
  const issue = checkVerse(lines, required);
  const ending = issue === null || issue === "tooShort" ? lastLetter(lines) : "";

  const edit = (update: (value: string) => void) => (value: string) => {
    update(value);
    onEdit();
  };

  const send = async () => {
    if (sending || issue !== null || lockedReason) return;
    const accepted = await onSend({ lines: lines.map((line) => line.trim()) });
    if (accepted) {
      setFirst("");
      setSecond("");
    } else {
      firstRef.current?.focus({ preventScroll: true });
    }
  };

  // Enter walks from the first mesra to the second; there it sends.
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    const inSecond = event.currentTarget === secondRef.current;
    if (event.key === "Backspace" && inSecond && !second) {
      event.preventDefault();
      firstRef.current?.focus();
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (inSecond || event.ctrlKey || event.metaKey) void send();
    else secondRef.current?.focus();
  };

  // A pasted couplet lands in both inputs, which would otherwise flatten it into one line.
  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = event.clipboardData.getData("text").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (pasted.length < 2) return;
    event.preventDefault();
    setFirst(pasted[0]);
    setSecond(pasted[1]);
    onEdit();
    secondRef.current?.focus();
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

      <div className="msh-composer" data-invalid={wrongStart || undefined}>
        <Button
          type="button"
          size="icon-lg"
          className="msh-send"
          disabled={sending || issue !== null || Boolean(lockedReason)}
          onClick={() => void send()}
          aria-label="ارسال بیت"
        >
          <ArrowUp aria-hidden="true" />
        </Button>
        <div className="msh-composer-lines">
          <textarea
            ref={firstRef}
            dir="rtl"
            rows={1}
            value={first}
            onChange={(event) => edit(setFirst)(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={required ? `مصراع اول، با «${required}»` : "مصراع اول"}
            aria-label="مصراع اول"
            aria-invalid={wrongStart || undefined}
            enterKeyHint="next"
            autoComplete="off"
            spellCheck={false}
          />
          <textarea
            ref={secondRef}
            dir="rtl"
            rows={1}
            value={second}
            onChange={(event) => edit(setSecond)(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="مصراع دوم"
            aria-label="مصراع دوم"
            enterKeyHint="send"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  );
}
