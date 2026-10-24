import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "کاوش | گنجورک",
  description: "گشت‌وگذار در شعرها و شاعران گنجورک؛ هر بار مجموعه‌ای تازه.",
};

export default function ExploreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
