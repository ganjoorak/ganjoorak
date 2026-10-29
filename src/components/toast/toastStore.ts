import type { ReactNode } from "react";

// A tiny toast queue. `toast()` can be called from anywhere (hooks, event handlers); <Toaster /> renders it.

export interface ToastAction {
  label: string;
  /** Internal path; rendered as a link. */
  href?: string;
  onClick?: () => void;
}

export interface ToastInput {
  title: string;
  description?: string;
  icon?: ReactNode;
  /** "celebrate" is for badges and streaks, "error" for failures. */
  tone?: "default" | "celebrate" | "error";
  action?: ToastAction;
  /** ms; 0 keeps it until dismissed. Default depends on the tone. */
  duration?: number;
}

export interface ToastItem extends ToastInput {
  id: number;
}

const MAX_VISIBLE = 3;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

export const subscribeToasts = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getToasts = () => items;
// useSyncExternalStore needs the same snapshot on every call.
const NO_TOASTS: ToastItem[] = [];
export const getServerToasts = () => NO_TOASTS;

export const dismissToast = (id: number) => {
  if (!items.some((item) => item.id === id)) return;
  items = items.filter((item) => item.id !== id);
  emit();
};

/** Shows a toast and returns its id. A toast with the same title replaces the one already showing. */
export const toast = (input: ToastInput) => {
  const id = nextId++;
  items = [...items.filter((item) => item.title !== input.title), { ...input, id }].slice(-MAX_VISIBLE);
  emit();
  return id;
};
