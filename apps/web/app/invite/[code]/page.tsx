import DashboardClient from "../../dashboard-client";

export const dynamic = "force-dynamic";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  return <DashboardClient referralCode={code} />;
}
