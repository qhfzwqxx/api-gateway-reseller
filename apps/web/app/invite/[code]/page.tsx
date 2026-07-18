import { AdminConfirmProvider } from "../../admin/_components/admin-confirm";
import DashboardClient from "../../dashboard-client";

export const dynamic = "force-dynamic";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  return (
    <AdminConfirmProvider>
      <DashboardClient referralCode={code} />
    </AdminConfirmProvider>
  );
}
