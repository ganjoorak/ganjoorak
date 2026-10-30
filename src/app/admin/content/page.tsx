import AdminContentPage from "@/components/admin/AdminContentPage";

type Props = { searchParams: Promise<{ tab?: string | string[] }> };

export default async function AdminContent({ searchParams }: Props) {
  const { tab } = await searchParams;
  return <AdminContentPage initialTab={tab === "quotes" || tab === "moves" ? tab : "profiles"} />;
}
