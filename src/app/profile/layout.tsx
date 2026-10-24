import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "حساب کاربری | گنجورک",
  description: "شعر در حال خواندن، آخرین شعر و پسندیده‌ها.",
  robots: { index: false },
};

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return children;
}
