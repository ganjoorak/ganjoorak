"use client";

import { useMemo, useState } from "react";
import { Segmented, formatNumber } from "@/components/admin/AdminParts";
import { lastDays } from "@/components/profile/profileFormat";
import type { TrendDay } from "@/utils/adminApi";

type Series = "active" | "signups" | "quotes" | "moves" | "matches";

const SERIES: readonly { value: Series; label: string; title: string }[] = [
  { value: "active", label: "فعال", title: "کاربران فعال" },
  { value: "signups", label: "ثبت‌نام", title: "ثبت‌نام‌ها" },
  { value: "quotes", label: "تکه", title: "تکه‌های تازه" },
  { value: "moves", label: "بیت", title: "بیت‌های اتاق عمومی" },
  { value: "matches", label: "مسابقه", title: "مسابقه‌های تازه" },
];

// viewBox units; the SVG stretches to the card's width.
const SLOT = 10;
const BAR = 8;
const HEIGHT = 96;
const RADIUS = 2;

const barPath = (x: number, top: number) =>
  `M${x} ${HEIGHT}V${top + RADIUS}Q${x} ${top} ${x + RADIUS} ${top}H${x + BAR - RADIUS}Q${x + BAR} ${top} ${x + BAR} ${top + RADIUS}V${HEIGHT}Z`;

/**
 * Thirty days of one series at a time, newest on the left as the page reads.
 * The line above the bars is the tooltip: touch has no hover, so tapping a bar
 * sets it too, and the table below holds every value.
 */
export default function AdminTrendChart({ trend }: { trend: TrendDay[] }) {
  const [series, setSeries] = useState<Series>("active");
  const [selected, setSelected] = useState<number | null>(null);

  const labels = useMemo(() => {
    const days = lastDays(trend[trend.length - 1].day, trend.length);
    return days.map((day) => day.label);
  }, [trend]);

  const values = trend.map((day) => day[series]);
  const peak = Math.max(...values);
  const scale = (HEIGHT - RADIUS * 2) / Math.max(peak, 1);
  const count = trend.length;
  const shown = selected ?? count - 1;
  const title = SERIES.find((item) => item.value === series)?.title ?? "";

  return (
    <div className="admin-chart">
      <Segmented label="شاخص نمودار" options={SERIES} value={series} onChange={setSeries} />
      <p className="admin-chart-readout" aria-live="polite">
        <strong>{formatNumber(values[shown])}</strong>
        <span>
          {title}، {labels[shown]}
        </span>
      </p>
      <div className="admin-chart-plot">
        <span className="admin-chart-peak">{formatNumber(peak)}</span>
        <svg
          viewBox={`0 0 ${count * SLOT} ${HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${title} در ${formatNumber(count)} روز گذشته؛ بیشترین ${formatNumber(peak)}`}
          onPointerLeave={() => setSelected(null)}
        >
          <line className="admin-chart-grid" x1="0" x2={count * SLOT} y1="0.5" y2="0.5" />
          <line className="admin-chart-grid" x1="0" x2={count * SLOT} y1={HEIGHT - 0.5} y2={HEIGHT - 0.5} />
          {trend.map((day, index) => {
            const slot = (count - 1 - index) * SLOT;
            const value = values[index];
            return (
              <g key={day.day}>
                {value > 0 && (
                  <path
                    className="admin-chart-bar"
                    data-active={index === shown}
                    d={barPath(slot + (SLOT - BAR) / 2, HEIGHT - Math.max(value * scale, RADIUS * 2))}
                  />
                )}
                <rect
                  className="admin-chart-hit"
                  x={slot}
                  y="0"
                  width={SLOT}
                  height={HEIGHT}
                  onPointerEnter={() => setSelected(index)}
                  onClick={() => setSelected(index)}
                />
              </g>
            );
          })}
        </svg>
      </div>
      <div className="admin-chart-axis" aria-hidden="true">
        <span>{labels[0]}</span>
        <span>{labels[count - 1]}</span>
      </div>
      <details className="admin-chart-table">
        <summary>نمایش جدول</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">روز</th>
              {SERIES.map((item) => (
                <th key={item.value} scope="col">
                  {item.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...trend].reverse().map((day, index) => (
              <tr key={day.day}>
                <th scope="row">{labels[count - 1 - index]}</th>
                {SERIES.map((item) => (
                  <td key={item.value}>{formatNumber(day[item.value])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
