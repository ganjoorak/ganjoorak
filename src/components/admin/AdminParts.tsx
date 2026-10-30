"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { FaSearch } from "react-icons/fa";
import { Button } from "@/components/ui/button";
import { Empty, EmptyTitle } from "@/components/ui/empty";
import { FormError } from "@/components/ui/form-error";
import { Spinner } from "@/components/ui/spinner";
import type { StaffRole } from "@/utils/accountApi";

// The small pieces every dashboard list shares.

const persianNumber = new Intl.NumberFormat("fa-IR");

export const formatNumber = (value: number) => persianNumber.format(value);

export const ROLE_LABELS: Record<StaffRole, string> = { "": "کاربر عادی", moderator: "ناظر", admin: "مدیر" };

export function Chip({ tone, children }: { tone?: "danger" | "primary"; children: ReactNode }) {
  return (
    <span className="admin-chip" data-tone={tone}>
      {children}
    </span>
  );
}

export function RoleChip({ role }: { role: StaffRole }) {
  return role ? <Chip tone="primary">{ROLE_LABELS[role]}</Chip> : null;
}

/** A one-choice filter; pass a short list, it shares the row with nothing else. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="app-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Calls onSearch once typing pauses, so a query does not run per key. */
export function SearchField({ label, onSearch }: { label: string; onSearch: (query: string) => void }) {
  const [value, setValue] = useState("");
  const onSearchRef = useRef(onSearch);
  onSearchRef.current = onSearch;

  useEffect(() => {
    const timer = window.setTimeout(() => onSearchRef.current(value.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [value]);

  return (
    <label className="app-search-field">
      <FaSearch aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={label}
        aria-label={label}
      />
    </label>
  );
}

/** What goes under a list: its error, spinner, empty state or the next-page button. */
export function ListFooter({
  isEmpty,
  emptyText,
  isLoading,
  error,
  hasMore,
  onMore,
}: {
  isEmpty: boolean;
  emptyText: string;
  isLoading: boolean;
  error: string;
  hasMore: boolean;
  onMore: () => void;
}) {
  if (error) return <FormError>{error}</FormError>;
  if (isLoading && isEmpty) {
    return (
      <div className="admin-gate admin-gate--inline">
        <Spinner />
      </div>
    );
  }
  if (isEmpty) {
    return (
      <Empty>
        <EmptyTitle>{emptyText}</EmptyTitle>
      </Empty>
    );
  }
  if (!hasMore) return null;
  return (
    <Button type="button" variant="outline" className="admin-more" disabled={isLoading} onClick={onMore}>
      نمایش بیشتر
    </Button>
  );
}
