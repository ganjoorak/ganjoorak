"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-error";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/toast/toastStore";

/** One step of moderation, held by the page until it is confirmed. */
export interface AdminAction {
  title: string;
  description?: string;
  confirmLabel: string;
  doneMessage: string;
  /** Destructive look; off for undoing something, such as an unban. */
  destructive?: boolean;
  reasonRequired?: boolean;
  run: (reason: string) => Promise<void>;
  onDone?: () => void;
}

/** Asks before an action and for its reason, which goes to the audit log. */
export default function AdminConfirmDialog({ action, onClose }: { action: AdminAction | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setReason("");
    setError("");
  }, [action]);

  const submit = async () => {
    if (!action) return;
    setIsSubmitting(true);
    setError("");
    try {
      await action.run(reason.trim());
      toast({ title: action.doneMessage });
      action.onDone?.();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "");
    } finally {
      setIsSubmitting(false);
    }
  };

  const isReady = !action?.reasonRequired || reason.trim() !== "";

  return (
    <Dialog
      open={action !== null}
      onOpenChange={(open) => {
        if (!open && !isSubmitting) onClose();
      }}
    >
      <DialogPopup dir="rtl">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (isReady) void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{action?.title}</DialogTitle>
            {action?.description && <DialogDescription>{action.description}</DialogDescription>}
          </DialogHeader>
          <DialogPanel>
            <label className="admin-field">
              <span>{action?.reasonRequired ? "دلیل" : "دلیل (اختیاری)"}</span>
              <Input value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} />
            </label>
            {error && <FormError>{error}</FormError>}
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={isSubmitting} onClick={onClose}>
              انصراف
            </Button>
            <Button type="submit" variant={action?.destructive ? "destructive" : "default"} disabled={!isReady || isSubmitting}>
              {action?.confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
