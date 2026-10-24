"use client";

import { useState } from "react";
import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { ListOrderedIcon, ShuffleIcon } from "lucide-react";

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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/context/SettingsContext";

type Order = "random" | "sequential";

const OPTIONS: {
  value: Order;
  title: string;
  description: string;
  icon: typeof ShuffleIcon;
}[] = [
  {
    value: "random",
    title: "تصادفی",
    description: "هر بار شعری ناهمنتظر از میان همه",
    icon: ShuffleIcon,
  },
  {
    value: "sequential",
    title: "پیاپی",
    description: "از ابتدای مجموعه، به ترتیب",
    icon: ListOrderedIcon,
  },
];

/**
 * Asked once on a poet page: read that poet's poems in random or collection order. The current setting is
 * preselected so the common case is a single tap on «ادامه».
 */
export default function RandomizePoemsPrompt({
  poetName,
  onChoose,
}: {
  poetName: string;
  onChoose: (randomize: boolean, rememberChoice: boolean) => void;
}) {
  const { settings } = useSettings();
  const [order, setOrder] = useState<Order>(
    settings.randomizePoems ? "random" : "sequential",
  );
  const [rememberChoice, setRememberChoice] = useState(false);

  return (
    <Dialog open disablePointerDismissal>
      <DialogPopup dir="rtl" showCloseButton={false} className="text-right sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="leading-8">
            شعرهای {poetName} را چطور بخوانید؟
          </DialogTitle>
          <DialogDescription className="leading-7">
            ترتیب نمایش شعرها را انتخاب کنید. بعداً هم از تنظیمات قابل تغییر است.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="grid gap-3">
          <RadioGroupPrimitive
            value={order}
            onValueChange={(value) => setOrder(value as Order)}
            aria-label="ترتیب نمایش شعرها"
            className="grid grid-cols-2 gap-3"
          >
            {OPTIONS.map(({ value, title, description, icon: Icon }) => (
              <RadioPrimitive.Root
                key={value}
                value={value}
                className="flex cursor-pointer flex-col items-start gap-2 rounded-xl border border-border p-4 text-start transition-colors outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/40 data-checked:border-foreground data-checked:bg-muted"
              >
                <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors in-data-checked:bg-foreground in-data-checked:text-background">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="grid gap-1">
                  <span className="text-sm font-bold">{title}</span>
                  <span className="text-xs leading-5 text-muted-foreground">
                    {description}
                  </span>
                </span>
              </RadioPrimitive.Root>
            ))}
          </RadioGroupPrimitive>
          <Label className="flex cursor-pointer items-center justify-between gap-3 px-1 text-sm font-normal text-muted-foreground">
            <span>این انتخاب برای همهٔ شاعران بماند و دوباره نپرسد</span>
            <Switch checked={rememberChoice} onCheckedChange={setRememberChoice} />
          </Label>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button size="lg" className="w-full" onClick={() => onChoose(order === "random", rememberChoice)}>
            ادامه
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
