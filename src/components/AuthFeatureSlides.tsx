"use client";

import { useEffect, useRef, useState, type TouchEvent } from "react";
import { Feather, Flame, Quote, Users, type LucideIcon } from "lucide-react";

const FEATURES: { title: string; text: string; Icon: LucideIcon }[] = [
  {
    title: "تکه‌های شعر",
    text: "هر جای شعری را که دوست داشتید انتخاب کنید و در صفحهٔ خودتان بگذارید.",
    Icon: Quote,
  },
  {
    title: "دنبال کردن",
    text: "کاربران را دنبال کنید و تکه‌هایی را که به اشتراک گذاشته‌اند ببینید.",
    Icon: Users,
  },
  {
    title: "مشاعره",
    text: "در مشاعرهٔ همگانی شرکت کنید یا با دوستانتان تیمی مسابقه بدهید.",
    Icon: Feather,
  },
  {
    title: "استریک و نشان",
    text: "هر روز شعر بخوانید، روزهای پیاپی‌تان را بسازید و نشان بگیرید.",
    Icon: Flame,
  },
];

const ADVANCE_MS = 5000;
const SWIPE_PX = 40;

/** What an account adds, on /login: all slides share one grid cell, so changing slide never moves the form. */
export default function AuthFeatureSlides() {
  const [active, setActive] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const touchStartX = useRef<number | null>(null);

  // Restarts on every change, so a slide the reader just picked gets its full time.
  useEffect(() => {
    if (isPaused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setTimeout(
      () => setActive((active + 1) % FEATURES.length),
      ADVANCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [active, isPaused]);

  const handleTouchEnd = (event: TouchEvent) => {
    const startX = touchStartX.current;
    touchStartX.current = null;
    if (startX === null) return;
    const distance = event.changedTouches[0].clientX - startX;
    if (Math.abs(distance) < SWIPE_PX) return;
    // RTL: the next slide comes from the left, so dragging right moves forward.
    const step = distance > 0 ? 1 : FEATURES.length - 1;
    setActive((index) => (index + step) % FEATURES.length);
  };

  return (
    <section
      className="auth-features"
      aria-roledescription="carousel"
      aria-label="ویژگی‌های گنجورک"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={() => setIsPaused(false)}
      onTouchStart={(event) => {
        touchStartX.current = event.touches[0].clientX;
      }}
      onTouchEnd={handleTouchEnd}
    >
      <div className="auth-features-track">
        {FEATURES.map(({ title, text, Icon }, index) => (
          <article
            key={title}
            className={`auth-feature${index === active ? " is-active" : ""}`}
            aria-hidden={index !== active}
          >
            <span className="auth-feature-icon" aria-hidden="true">
              <Icon />
            </span>
            <div>
              <h2>{title}</h2>
              <p>{text}</p>
            </div>
          </article>
        ))}
      </div>
      <div className="auth-features-dots">
        {FEATURES.map(({ title }, index) => (
          <button
            key={title}
            type="button"
            className={index === active ? "is-active" : undefined}
            aria-label={title}
            aria-current={index === active ? "true" : undefined}
            onClick={() => setActive(index)}
          />
        ))}
      </div>
    </section>
  );
}
