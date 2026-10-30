import { notFound } from "next/navigation";
import AdminUserPage from "@/components/admin/AdminUserPage";

type Props = { params: Promise<{ id: string }> };

export default async function AdminUser({ params }: Props) {
  const { id } = await params;
  if (!/^[1-9]\d{0,15}$/.test(id)) notFound();
  return <AdminUserPage id={Number(id)} />;
}
