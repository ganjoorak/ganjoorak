"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  dismissToast,
  getServerToasts,
  getToasts,
  subscribeToasts,
  type ToastItem,
} from "@/components/toast/toastStore";
import "@/styles/toast.css";

const DEFAULT_DURATION: Record<NonNullable<ToastItem["tone"]>, number> = {
  default: 4000,
  celebrate: 6000,
  error: 6000,
};

function ToastCard({ item, reduceMotion }: { item: ToastItem; reduceMotion: boolean }) {
  const tone = item.tone ?? "default";
  const duration = item.duration ?? DEFAULT_DURATION[tone];

  useEffect(() => {
    if (duration <= 0) return;
    const timer = window.setTimeout(() => dismissToast(item.id), duration);
    return () => window.clearTimeout(timer);
  }, [duration, item.id]);

  const action = item.action;
  return (
    <motion.div
      layout={!reduceMotion}
      className={`gk-toast gk-toast--${tone}`}
      role={tone === "error" ? "alert" : "status"}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -16, scale: 0.96 }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.97 }}
      transition={{ duration: reduceMotion ? 0.12 : 0.28, ease: [0.32, 0.72, 0, 1] }}
    >
      {item.icon && (
        <span className="gk-toast__icon" aria-hidden="true">
          {item.icon}
        </span>
      )}
      <div className="gk-toast__body">
        <p className="gk-toast__title">{item.title}</p>
        {item.description && <p className="gk-toast__description">{item.description}</p>}
      </div>
      {action &&
        (action.href ? (
          <Link
            href={action.href}
            className={buttonVariants({ variant: "outline", size: "sm", className: "gk-toast__action" })}
            onClick={() => {
              action.onClick?.();
              dismissToast(item.id);
            }}
          >
            {action.label}
          </Link>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gk-toast__action"
            onClick={() => {
              action.onClick?.();
              dismissToast(item.id);
            }}
          >
            {action.label}
          </Button>
        ))}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="gk-toast__close"
        aria-label="بستن"
        onClick={() => dismissToast(item.id)}
      >
        <X aria-hidden="true" />
      </Button>
    </motion.div>
  );
}

/** The single toast container; mounted once in the root layout. */
export default function Toaster() {
  const items = useSyncExternalStore(subscribeToasts, getToasts, getServerToasts);
  const reduceMotion = useReducedMotion() ?? false;

  return (
    <div className="gk-toaster" role="region" aria-label="اعلان‌ها" dir="rtl">
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <ToastCard key={item.id} item={item} reduceMotion={reduceMotion} />
        ))}
      </AnimatePresence>
    </div>
  );
}
