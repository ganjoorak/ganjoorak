"use client";

import React, { useMemo, useState } from "react";
import { FaTimes } from "react-icons/fa";
import {
  DEFAULT_SUGGESTED_INTEREST_KEYS,
  POEM_INTERESTS,
} from "@/data/interests";
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
import { Toggle } from "@/components/ui/toggle";

interface InterestPickerDialogProps {
  selectedKeys: string[];
  isFirstRun?: boolean;
  onSave: (keys: string[]) => void;
  onClose: () => void;
}

const persianNumber = new Intl.NumberFormat("fa-IR");

const InterestPickerDialog: React.FC<InterestPickerDialogProps> = ({
  selectedKeys,
  isFirstRun = false,
  onSave,
  onClose,
}) => {
  const [pendingKeys, setPendingKeys] = useState<string[]>(selectedKeys);
  const pendingKeySet = useMemo(() => new Set(pendingKeys), [pendingKeys]);

  const toggleInterest = (key: string) => {
    setPendingKeys((currentKeys) =>
      currentKeys.includes(key)
        ? currentKeys.filter((currentKey) => currentKey !== key)
        : [...currentKeys, key],
    );
  };

  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup dir="rtl" showCloseButton={false} className="sm:max-w-3xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-4">
            <DialogTitle>علاقه‌مندی‌های شما</DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              className="size-11"
              onClick={onClose}
              aria-label="بستن"
            >
              <FaTimes />
            </Button>
          </div>
          <DialogDescription className="leading-7">
            {isFirstRun
              ? "چه نوع شعرهایی دوست دارید؟ چند مورد را انتخاب کنید تا دسته‌بندی‌ها بالای صفحه اصلی پیشنهاد شوند."
              : "دسته‌بندی‌های انتخاب‌شده بالای صفحه اصلی نمایش داده می‌شوند."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="interest-picker-summary">
            <span>
              <strong>{persianNumber.format(pendingKeys.length)}</strong> دسته
              انتخاب شده
            </span>
            <span>
              از <strong>{persianNumber.format(POEM_INTERESTS.length)}</strong>{" "}
              دسته
            </span>
          </div>
          <div className="interest-picker-grid">
            {POEM_INTERESTS.map((interest) => (
              <Toggle
                key={interest.key}
                variant="outline"
                className="h-auto min-h-11 justify-start whitespace-normal px-3 py-2 text-start data-pressed:border-primary"
                pressed={pendingKeySet.has(interest.key)}
                onPressedChange={() => toggleInterest(interest.key)}
              >
                {interest.label}
              </Toggle>
            ))}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button
            variant="outline"
            className="h-11"
            onClick={() => setPendingKeys(DEFAULT_SUGGESTED_INTEREST_KEYS)}
          >
            پیشنهاد گنجورک
          </Button>
          <Button
            variant="outline"
            className="h-11"
            onClick={() => setPendingKeys([])}
          >
            پاک کردن
          </Button>
          <Button className="h-11" onClick={() => onSave(pendingKeys)}>
            ذخیره
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};

export default InterestPickerDialog;
