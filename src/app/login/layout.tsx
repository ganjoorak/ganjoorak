import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ورود | گنجورک",
  description: "ورود یا ساخت حساب در گنجورک.",
  robots: { index: false },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
