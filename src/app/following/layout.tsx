import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "دنبال‌شده‌ها | گنجورک",
  description: "کسانی که در گنجورک دنبال می‌کنید و دنبال‌کنندگان شما.",
  robots: { index: false },
};

export default function FollowingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
