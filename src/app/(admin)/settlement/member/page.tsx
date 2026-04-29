import { redirect } from 'next/navigation';

interface PageProps {
  searchParams: Promise<{
    year_month?: string;
    member_id?: string;
    debug?: string;
  }>;
}

export default async function AdminSettlementMemberRedirectPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { year_month, member_id, debug } = params;

  const sp = new URLSearchParams();
  if (year_month) sp.set('year_month', year_month);
  if (member_id) sp.set('member_id', member_id);
  if (debug) sp.set('debug', debug);

  redirect(`/admin/settlement/member?${sp.toString()}`);
}

