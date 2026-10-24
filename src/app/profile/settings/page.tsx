import type { Metadata } from "next";
import AccountSettingsPage from "@/components/AccountSettingsPage";

export const metadata: Metadata = {
  title: "تنظیمات حساب | گنجورک",
  robots: { index: false },
};

export default function Page() {
  return <AccountSettingsPage />;
}
