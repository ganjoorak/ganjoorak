"use client";

import { useMemo } from "react";
import { Flame } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { lastDays, tehranDay } from "@/components/profile/profileFormat";
import { formatPersianNumber } from "@/utils/searchText";
import type { Streak } from "@/utils/progressApi";
import "../../styles/ProfileSections.css";

const CALENDAR_DAYS = 28;

/** The owner's streak: current run, best run, total reads and a 28-day calendar. */
export function StreakCard({ streak }: { streak: Streak }) {
  const days = useMemo(() => {
    const read = new Set(streak.days);
    const today = tehranDay();
    return lastDays(today, CALENDAR_DAYS).map((entry) => ({
      ...entry,
      read: read.has(entry.day),
      isToday: entry.day === today,
    }));
  }, [streak.days]);

  const active = streak.current > 0;

  return (
    <Card className="streak-card" role="group" aria-labelledby="streak-title">
      <CardContent className="streak-head">
        <span className="app-row-icon streak-flame" data-active={active} aria-hidden="true">
          <Flame />
        </span>
        <div className="app-row-body">
          <strong id="streak-title" className="app-row-title">
            {active ? `${formatPersianNumber(streak.current)} روز پیاپی` : "امروز شعری بخوانید"}
          </strong>
          <span className="app-row-meta">
            {active && !streak.today
              ? "برای ادامهٔ رشته امروز یک شعر بخوانید."
              : active
                ? "امروز هم خواندید."
                : "با خواندن هر روز یک شعر، رشتهٔ تازه‌ای شروع می‌شود."}
          </span>
        </div>
      </CardContent>

      <dl className="streak-stats">
        <div>
          <dt>بهترین رشته</dt>
          <dd>{formatPersianNumber(streak.best)} روز</dd>
        </div>
        <div>
          <dt>شعر خوانده‌شده</dt>
          <dd>{formatPersianNumber(streak.totalPoems)}</dd>
        </div>
      </dl>

      <ol className="streak-calendar" aria-label="۲۸ روز گذشته">
        {days.map((entry) => (
          <li
            key={entry.day}
            className="streak-day"
            data-read={entry.read}
            data-today={entry.isToday}
            aria-label={`${entry.label}${entry.read ? "، خوانده‌اید" : ""}${entry.isToday ? " (امروز)" : ""}`}
            title={entry.label}
          />
        ))}
      </ol>
    </Card>
  );
}

/** Compact streak for public profiles: current run and best run. */
export function StreakChip({ streak }: { streak: Pick<Streak, "current" | "best"> }) {
  if (streak.current <= 0 && streak.best <= 0) {
    return null;
  }
  return (
    <p className="streak-chip" aria-label="رشتهٔ خواندن">
      <Flame aria-hidden="true" data-active={streak.current > 0} />
      <span>
        {streak.current > 0 ? `${formatPersianNumber(streak.current)} روز پیاپی` : "رشته‌ای در جریان نیست"}
      </span>
      {streak.best > 0 && (
        <span className="streak-chip-best">بهترین: {formatPersianNumber(streak.best)}</span>
      )}
    </p>
  );
}
