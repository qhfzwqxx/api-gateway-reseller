"use client";

import { Header } from "../../components/layout/header";
import { Sidebar } from "../../components/layout/sidebar";
import { QueryProvider } from "../../components/providers/query-provider";
import { MobileTableEnhancer } from "./components/mobile-table-enhancer";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";

function getAdminToken() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem("gateway_admin_token");
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    if (!getAdminToken()) {
      router.replace("/login");
    }
  }, [router]);

  return (
    <QueryProvider>
      <div className="admin-app-shell flex h-screen overflow-hidden bg-slate-50 text-slate-950">
        <MobileTableEnhancer />
        <Sidebar />
        <div className="admin-app-frame flex h-full min-w-0 flex-1 flex-col overflow-hidden lg:pl-64">
          <Header />
          <main id="admin-main-scroll" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4">{children}</main>
        </div>
      </div>
    </QueryProvider>
  );
}
