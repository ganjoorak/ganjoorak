import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "مشاعره | گنجورک",
  description: "مشاعرهٔ همگانی و مسابقهٔ تیمی یا رودررو با دوستان: هر بیت با آخرین حرف بیت پیش شروع می‌شود.",
  robots: { index: false },
};

export default function MoshaereLayout({ children }: { children: React.ReactNode }) {
  return children;
}
