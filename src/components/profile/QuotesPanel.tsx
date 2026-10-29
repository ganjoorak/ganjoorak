"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Quote as QuoteIcon, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyIcon } from "@/components/ui/empty";
import { FormError } from "@/components/ui/form-error";
import { formatRelativeTime } from "@/components/profile/profileFormat";
import { AccountError } from "@/utils/accountApi";
import { deleteQuote, fetchUserQuotes, type Quote } from "@/utils/quotesApi";
import "@/styles/searchStyles";
import "../../styles/ProfileSections.css";

const errorMessage = (caught: unknown) => (caught instanceof AccountError ? caught.message : "خطایی رخ داد.");

/** Verse lines grouped in couplets (two lines, a Ganjoor beyt), as the search results show them. */
const QuoteLines = ({ lines }: { lines: string[] }) => {
  const couplets: string[][] = [];
  for (let index = 0; index < lines.length; index += 2) {
    couplets.push(lines.slice(index, index + 2));
  }
  return (
    <blockquote className="search-hit-verse">
      {couplets.map((couplet, index) => (
        <span key={index} className="search-hit-couplet">
          {couplet.map((line, lineIndex) => (
            <span key={lineIndex} className="search-hit-line is-match">
              {line}
            </span>
          ))}
        </span>
      ))}
    </blockquote>
  );
};

const QuoteCard = ({
  quote,
  canDelete,
  onDelete,
}: {
  quote: Quote;
  canDelete: boolean;
  onDelete: (quote: Quote) => Promise<void>;
}) => {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <li className="quote-card">
      <QuoteLines lines={quote.lines} />
      <div className="search-hit-meta">
        <Link href={quote.href} prefetch={false} className="quote-source search-hit-crumb">
          <strong className="quote-poet">{quote.poetName}</strong>
          <span>{quote.poemTitle}</span>
        </Link>
        <time dateTime={new Date(quote.createdAt).toISOString()} suppressHydrationWarning>
          {formatRelativeTime(quote.createdAt)}
        </time>
        {canDelete &&
          (confirming ? (
            <span className="quote-confirm" role="group" aria-label="حذف این تکه">
              <Button
                type="button"
                variant="destructive"
                size="xs"
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  await onDelete(quote);
                  setBusy(false);
                  setConfirming(false);
                }}
              >
                حذف
              </Button>
              <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={() => setConfirming(false)}>
                انصراف
              </Button>
            </span>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="حذف این تکه"
              onClick={() => setConfirming(true)}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          ))}
      </div>
    </li>
  );
};

/**
 * A person's shared poem fragments, newest first. A public profile hands over
 * the first page it already rendered (`initial`); the owner's page loads it here.
 */
export function QuotesPanel({
  username,
  isOwner,
  initial,
}: {
  username: string;
  isOwner: boolean;
  initial?: { quotes: Quote[]; next: number | null };
}) {
  const [quotes, setQuotes] = useState<Quote[]>(initial?.quotes ?? []);
  const [next, setNext] = useState<number | null>(initial?.next ?? null);
  const [loaded, setLoaded] = useState(Boolean(initial));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    async (before?: number) => {
      setLoading(true);
      setError("");
      try {
        const page = await fetchUserQuotes(username, before);
        setQuotes((current) => {
          const seen = new Set(current.map((quote) => quote.id));
          return before ? [...current, ...page.quotes.filter((quote) => !seen.has(quote.id))] : page.quotes;
        });
        setNext(page.next);
        setLoaded(true);
      } catch (caught) {
        // A private account can't be read through the public list; the owner just sees none.
        if (!before && caught instanceof AccountError && caught.status === 404) {
          setLoaded(true);
        } else {
          setError(errorMessage(caught));
        }
      } finally {
        setLoading(false);
      }
    },
    [username],
  );

  useEffect(() => {
    if (!initial) {
      void load();
    }
    // `initial` is only the first page; it never changes for a mounted panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const handleDelete = async (quote: Quote) => {
    try {
      await deleteQuote(quote.id);
      setQuotes((current) => current.filter((item) => item.id !== quote.id));
      setError("");
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  if (!loaded && !error) {
    return (
      <Empty role="status">
        <EmptyDescription>در حال بارگذاری…</EmptyDescription>
      </Empty>
    );
  }

  return (
    <div className="quotes-panel">
      {quotes.length === 0 ? (
        <Empty>
          <EmptyIcon>
            <QuoteIcon />
          </EmptyIcon>
          <EmptyDescription>
            {isOwner
              ? "هنوز تکه‌ای نگذاشته‌اید. در صفحهٔ شعر چند مصراع را انتخاب کنید و «در صفحهٔ من» را بزنید."
              : "هنوز تکه‌ای نگذاشته است."}
          </EmptyDescription>
        </Empty>
      ) : (
        <ul className="quote-list">
          {quotes.map((quote) => (
            <QuoteCard key={quote.id} quote={quote} canDelete={isOwner} onDelete={handleDelete} />
          ))}
        </ul>
      )}
      {error && <FormError>{error}</FormError>}
      {next !== null && (
        <Button
          type="button"
          variant="outline"
          className="quotes-more"
          loading={loading}
          onClick={() => void load(next)}
        >
          نمایش بیشتر
        </Button>
      )}
    </div>
  );
}
