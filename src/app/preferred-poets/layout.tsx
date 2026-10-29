import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "شاعران مورد علاقه | گنجورک",
  description: "شاعرانی که در گنجورک به علاقه‌مندی‌هایتان افزوده‌اید.",
};

export default function PreferredPoetsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
