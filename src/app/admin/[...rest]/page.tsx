import { notFound } from "next/navigation";

// Without this, /admin/foo would fall through to the [poet]/[id] routes.
export default function AdminUnknown() {
  notFound();
}
