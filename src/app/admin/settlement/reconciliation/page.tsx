import type { Metadata } from 'next';
import { getSettlementWindowSeoul } from '@/lib/settlement/settlement-window';
import ReconciliationClient from './ReconciliationClient';

export const metadata: Metadata = { title: '본사 정산 검증' };
export const dynamic = 'force-dynamic';

export default async function SettlementReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ year_month?: string }>;
}) {
  const params = await searchParams;
  const requested = String(params.year_month ?? '').trim();
  const initialYearMonth = /^\d{4}-\d{2}$/.test(requested)
    ? requested
    : getSettlementWindowSeoul().label_year_month;

  return <ReconciliationClient initialYearMonth={initialYearMonth} />;
}
