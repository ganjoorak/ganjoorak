"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import AppPage from "@/components/AppPage";
import { useAdmin } from "@/components/admin/AdminShell";
import { formatNumber } from "@/components/admin/AdminParts";

const NAV_ITEMS = [
  { href: "/admin", label: "نمای کلی", adminOnly: true },
  { href: "/admin/users", label: "کاربران", adminOnly: true },
  { href: "/admin/content", label: "محتوا", adminOnly: false },
  { href: "/admin/feedback", label: "بازخورد", adminOnly: false },
  { href: "/admin/audit", label: "کارنامه", adminOnly: true },
];

function AdminNav() {
  const pathname = usePathname();
  const { role, openFeedback } = useAdmin();
  return (
    <nav className="admin-nav" aria-label="بخش‌های مدیریت">
      {NAV_ITEMS.filter((item) => role === "admin" || !item.adminOnly).map((item) => {
        const active = item.href === "/admin" ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href} prefetch={false} aria-current={active ? "page" : undefined}>
            {item.label}
            {item.href === "/admin/feedback" && openFeedback > 0 && (
              <span className="admin-nav-count">{formatNumber(openFeedback)}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/** A dashboard page; moderators are sent on from the sections that are not theirs. */
export default function AdminPage({
  title,
  subtitle,
  adminOnly = false,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  adminOnly?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const { role } = useAdmin();
  const isBlocked = adminOnly && role !== "admin";

  useEffect(() => {
    if (isBlocked) router.replace("/admin/content");
  }, [isBlocked, router]);

  if (isBlocked) return null;
  return (
    <AppPage title={title} subtitle={subtitle} headerExtra={<AdminNav />} width="wide" className="admin-page">
      {children}
    </AppPage>
  );
}
