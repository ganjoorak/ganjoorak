"use client";

import { useRef } from "react";
import Link from "next/link";
import { FaExternalLinkAlt, FaTimes } from "react-icons/fa";
import { SearchView, useSearchDialogState } from "@/components/SearchPage";
import { Button } from "@/components/ui/button";
import { Dialog, DialogPopup, DialogTitle } from "@/components/ui/dialog";

interface GlobalSearchDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * The /search page in a dialog (a bottom sheet on phones), opened from the floating search
 * buttons. The search lives in local state, so reopening shows the last one.
 */
const GlobalSearchDialog = ({ isOpen, onClose }: GlobalSearchDialogProps) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const search = useSearchDialogState();

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup
        dir="rtl"
        showCloseButton={false}
        initialFocus={inputRef}
        className="search-dialog h-[min(88dvh,52rem)] text-right max-sm:h-[calc(100dvh-1rem-env(safe-area-inset-top))] sm:max-w-2xl"
      >
        <div className="search-dialog-head">
          <DialogTitle className="text-lg">جست‌وجو</DialogTitle>
          <div className="search-dialog-actions">
            <Link href={search.href} className="search-text-button" onClick={onClose}>
              <FaExternalLinkAlt aria-hidden="true" />
              صفحهٔ جست‌وجو
            </Link>
            <Button variant="ghost" size="icon" className="size-10" onClick={onClose} aria-label="بستن">
              <FaTimes aria-hidden="true" />
            </Button>
          </div>
        </div>
        <div className="search-dialog-body">
          <SearchView
            variant="dialog"
            state={search.state}
            onChange={search.onChange}
            onNavigate={onClose}
            inputRef={inputRef}
          />
        </div>
      </DialogPopup>
    </Dialog>
  );
};

export default GlobalSearchDialog;
