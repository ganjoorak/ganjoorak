"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Copy, Image as ImageIcon, LogIn, Quote as QuoteIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { toast } from "@/components/toast/toastStore";
import { usePoemSelection } from "@/components/poem-viewer/usePoemSelection";
import { useAccountSession } from "@/hooks/useAccountSession";
import type { Poem } from "@/types/poem";
import { AccountError, publicProfilePath } from "@/utils/accountApi";
import { getPoemLibraryKey } from "@/utils/poemLibrary";
import { poemToLines } from "@/utils/poemLines";
import { createQuote, MAX_QUOTE_LINES } from "@/utils/quotesApi";
import { formatPersianNumber } from "@/utils/searchText";
import "@/styles/poem-selection.css";

const EDGE_MARGIN = 8;
// Gap between the selected lines and the toolbar. On touch the native selection handles hang below the
// last line, so the toolbar sits further down to stay clear of them.
const GAP_FINE = 10;
const GAP_COARSE = 40;

interface PoemSelectionMenuProps {
  poem: Poem;
  /** The viewer root; the selection only counts inside its `.poem-text[data-poem-id]`. */
  containerRef: RefObject<HTMLElement | null>;
  /** True while a dialog or drawer owns the screen. */
  disabled?: boolean;
  /** Opens the share dialog with these lines (inclusive indices) selected. */
  onShareCard: (from: number, to: number) => void;
}

const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers / insecure origins: fall back to a hidden textarea.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
};

/**
 * The floating toolbar over a text selection in the poem: share it on one's page («در صفحهٔ من»), copy it,
 * or make a share card. The selection is rounded to whole lines (see usePoemSelection) and those lines are
 * highlighted while the toolbar is open.
 */
export default function PoemSelectionMenu({ poem, containerRef, disabled = false, onShareCard }: PoemSelectionMenuProps) {
  const poemId = String(poem.id);
  const { selection, isVisible, holdOpen, dismiss } = usePoemSelection({
    containerRef,
    poemId,
    enabled: !disabled,
  });
  const { user, isSignedIn, isLoading } = useAccountSession();
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => setContainer(document.body), []);

  const from = selection?.from ?? 0;
  const to = selection?.to ?? 0;
  const lineCount = selection ? to - from + 1 : 0;
  const isOverLimit = lineCount > MAX_QUOTE_LINES;

  // Highlight the rounded lines while the toolbar is up. A data attribute, not a class: React owns className.
  useEffect(() => {
    if (!isVisible || !selection) return;
    const root = containerRef.current?.querySelector<HTMLElement>(`.poem-text[data-poem-id="${CSS.escape(poemId)}"]`);
    if (!root) return;
    const marked: HTMLElement[] = [];
    root.querySelectorAll<HTMLElement>("[data-line-index]").forEach((element) => {
      const index = Number(element.dataset.lineIndex);
      if (index >= selection.from && index <= selection.to) {
        element.setAttribute("data-quote-selected", "");
        marked.push(element);
      }
    });
    return () => marked.forEach((element) => element.removeAttribute("data-quote-selected"));
  }, [containerRef, isVisible, poemId, selection]);

  // Place the toolbar once it has a size: above the lines on desktop, below them on touch devices.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!isVisible || !selection || !menu) {
      setPosition(null);
      return;
    }
    const { width, height } = menu.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewWidth = viewport?.width ?? window.innerWidth;
    const viewHeight = viewport?.height ?? window.innerHeight;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const { rect } = selection;
    const centerX = (rect.left + rect.right) / 2;
    const left = Math.min(Math.max(centerX - width / 2, EDGE_MARGIN), Math.max(EDGE_MARGIN, viewWidth - width - EDGE_MARGIN));
    const above = rect.top - height - GAP_FINE;
    const below = rect.bottom + (coarse ? GAP_COARSE : GAP_FINE);
    let top: number;
    if (coarse) {
      // Below the handles; with no room left, above the lines but clear of the native menu.
      top = below + height <= viewHeight - EDGE_MARGIN ? below : Math.max(EDGE_MARGIN, rect.top - height - GAP_COARSE * 1.6);
    } else {
      top = above >= EDGE_MARGIN ? above : below;
    }
    top = Math.min(Math.max(top, EDGE_MARGIN), Math.max(EDGE_MARGIN, viewHeight - height - EDGE_MARGIN));
    setPosition({ left, top });
  }, [isVisible, selection, isSignedIn, isOverLimit]);

  const saveQuote = useCallback(async () => {
    if (!selection || isSaving) return;
    const lastLine = Math.min(selection.to, selection.from + MAX_QUOTE_LINES - 1);
    setIsSaving(true);
    try {
      await createQuote(getPoemLibraryKey(poem), selection.from, lastLine);
      dismiss();
      const profileHref = user?.isPublic ? publicProfilePath(user.username) : "/profile";
      toast({
        title: "در صفحهٔ شما گذاشته شد",
        description: user && !user.isPublic ? "نمایه‌تان خصوصی است؛ فقط خودتان آن را می‌بینید." : undefined,
        tone: "celebrate",
        icon: <QuoteIcon />,
        action: { label: "دیدن در نمایه", href: profileHref },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "ذخیره نشد. دوباره امتحان کنید.";
      const needsLogin = error instanceof AccountError && error.status === 401;
      toast({
        title: needsLogin ? "برای اشتراک وارد شوید" : message,
        description: needsLogin ? "با ورود می‌توانید بیت‌ها را در صفحهٔ خودتان بگذارید." : undefined,
        tone: "error",
        action: needsLogin ? { label: "ورود", href: "/login" } : undefined,
      });
    } finally {
      setIsSaving(false);
    }
  }, [dismiss, isSaving, poem, selection, user]);

  const copyLines = useCallback(async () => {
    if (!selection) return;
    const text = poemToLines(poem).slice(selection.from, selection.to + 1).join("\n");
    const ok = await copyText(poem.poet ? `${text}\n— ${poem.poet}` : text);
    dismiss();
    toast(ok ? { title: "کپی شد" } : { title: "کپی انجام نشد", tone: "error" });
  }, [dismiss, poem, selection]);

  if (!isVisible || !selection || !container) return null;

  const stop = (event: { preventDefault: () => void }) => {
    // Keep the text selected (and focus where it was) while a button is pressed.
    event.preventDefault();
    holdOpen();
  };

  return createPortal(
    <div
      ref={menuRef}
      className="gk-selmenu"
      role="toolbar"
      aria-label="کنش‌های متن انتخاب‌شده"
      dir="rtl"
      style={position ? { left: position.left, top: position.top } : { left: 0, top: 0, visibility: "hidden" }}
      onMouseDown={stop}
      onPointerDown={holdOpen}
    >
      <div className="gk-selmenu__row">
        {isSignedIn || isLoading ? (
          <Button type="button" variant="ghost" className="gk-selmenu__button" onClick={saveQuote} disabled={isSaving}>
            <QuoteIcon aria-hidden="true" />
            {isSaving ? "در حال ذخیره…" : "در صفحهٔ من"}
          </Button>
        ) : (
          <Link href="/login" className={buttonVariants({ variant: "ghost", className: "gk-selmenu__button" })}>
            <LogIn aria-hidden="true" />
            برای اشتراک وارد شوید
          </Link>
        )}
        <Button type="button" variant="ghost" className="gk-selmenu__button" onClick={copyLines}>
          <Copy aria-hidden="true" />
          کپی
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="gk-selmenu__button"
          onClick={() => {
            const { from: start, to: end } = selection;
            dismiss();
            onShareCard(start, end);
          }}
        >
          <ImageIcon aria-hidden="true" />
          اشتراک
        </Button>
      </div>
      {isOverLimit && isSignedIn && (
        <p className="gk-selmenu__hint">
          در صفحه فقط {formatPersianNumber(MAX_QUOTE_LINES)} مصرع نخست می‌ماند.
        </p>
      )}
    </div>,
    container,
  );
}
