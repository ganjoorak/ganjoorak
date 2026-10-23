import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "حساب کاربری | گنجورک",
  description: "شعرهای در حال خواندن، پسندیده‌ها و شاعران دنبال‌شده.",
  robots: { index: false },
};

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return children;
}
