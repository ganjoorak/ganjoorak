"use client";

import { useRef } from "react";
import { SearchView, useSearchDialogState } from "@/components/SearchPage";
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
        {/* No header: Escape, the backdrop or the sheet's grabber close it. */}
        <DialogTitle className="sr-only">جست‌وجو</DialogTitle>
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
