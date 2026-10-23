import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "شاعران دنبال‌شده | گنجورک",
  description: "شاعرانی که در گنجورک دنبال می‌کنید.",
};

export default function FollowingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
