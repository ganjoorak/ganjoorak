"use client";

import React, { useMemo, useState } from "react";
import { CheckIcon, XIcon } from "lucide-react";
import {
  DEFAULT_SUGGESTED_INTEREST_KEYS,
  POEM_INTERESTS,
} from "@/data/interests";
import { Badge } from "@/components/ui/badge";
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
      <DialogPopup dir="rtl" showCloseButton={false} className="sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-4">
            <DialogTitle>علاقه‌مندی‌های شما</DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="بستن"
            >
              <XIcon />
            </Button>
          </div>
          <DialogDescription className="leading-7">
            {isFirstRun
              ? "چه نوع شعرهایی دوست دارید؟ چند موضوع را انتخاب کنید تا بالای صفحهٔ اصلی پیشنهاد شوند."
              : "موضوع‌های انتخاب‌شده بالای صفحهٔ اصلی نمایش داده می‌شوند."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="overflow-y-auto">
          <div className="mb-3 flex items-center justify-between gap-2">
            <Badge variant="secondary" className="h-6 px-2.5 text-[0.8rem]">
              {persianNumber.format(pendingKeys.length)} از{" "}
              {persianNumber.format(POEM_INTERESTS.length)} موضوع
            </Badge>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPendingKeys(DEFAULT_SUGGESTED_INTEREST_KEYS)}
              >
                پیشنهاد گنجورک
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={pendingKeys.length === 0}
                onClick={() => setPendingKeys([])}
              >
                پاک کردن
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {POEM_INTERESTS.map((interest) => {
              const isSelected = pendingKeySet.has(interest.key);
              return (
                <Toggle
                  key={interest.key}
                  variant="outline"
                  size="lg"
                  className="rounded-full px-4 data-pressed:border-foreground data-pressed:bg-foreground data-pressed:text-background data-pressed:hover:bg-foreground/90"
                  pressed={isSelected}
                  onPressedChange={() => toggleInterest(interest.key)}
                >
                  {isSelected && <CheckIcon aria-hidden="true" />}
                  {interest.label}
                </Toggle>
              );
            })}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" size="lg" onClick={onClose}>
            انصراف
          </Button>
          <Button size="lg" onClick={() => onSave(pendingKeys)}>
            ذخیره
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};

export default InterestPickerDialog;
