"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import AppNotFound from "@/app/not-found";
import { Spinner } from "@/components/ui/spinner";
import { FormError } from "@/components/ui/form-error";
import { AccountError, type StaffRole } from "@/utils/accountApi";
import { fetchAdminSession } from "@/utils/adminApi";
import "../../styles/Admin.css";

interface AdminContextValue {
  role: StaffRole;
  openFeedback: number;
  /** Refreshes the unread count after the inbox changes. */
  refresh: () => void;
}

const AdminContext = createContext<AdminContextValue>({ role: "", openFeedback: 0, refresh: () => {} });

export const useAdmin = () => useContext(AdminContext);

/**
 * Gate of the /admin pages. It only decides what to draw: the service checks the
 * role on every call, and this HTML holds no data.
 */
export default function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<{ role: StaffRole; openFeedback: number } | null>(null);
  const [isDenied, setIsDenied] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    fetchAdminSession()
      .then(setSession)
      .catch((reason: unknown) => {
        if (reason instanceof AccountError && reason.status === 401) {
          router.replace("/login");
        } else if (reason instanceof AccountError && reason.status === 403) {
          setIsDenied(true);
        } else {
          setError(reason instanceof Error ? reason.message : "");
        }
      });
  }, [router]);

  useEffect(refresh, [refresh]);

  const value = useMemo(
    () => ({ role: session?.role ?? ("" as StaffRole), openFeedback: session?.openFeedback ?? 0, refresh }),
    [refresh, session],
  );

  if (isDenied) return <AppNotFound />;
  if (error) {
    return (
      <div className="admin-gate" dir="rtl">
        <FormError>{error}</FormError>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="admin-gate" dir="rtl">
        <Spinner />
      </div>
    );
  }
  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}
