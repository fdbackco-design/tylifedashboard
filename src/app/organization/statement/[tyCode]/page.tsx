/**
 * 영업자별 지급명세서 공개 페이지.
 *
 * URL: /organization/statement/{tyCode}?year_month=YYYY-MM
 *
 * 보안:
 *   - 본 서버 컴포넌트는 명세서 데이터를 절대 사전 로드하지 않는다.
 *   - 페이지는 "전산코드 입력 게이트" 만 렌더한다.
 *   - 사용자가 입력한 코드와 URL 의 tyCode 가 일치할 때 클라이언트가 API 를 호출하여
 *     서버에서 한 번 더 검증 후 데이터가 전달된다.
 *
 * 기존 /organization/statement 페이지의 동작은 변경하지 않는다.
 */

import type { Metadata } from 'next';
import {
  coalesceYearMonthSearchParam,
  getSettlementWindowSeoul,
  normalizeYearMonthLabel,
} from '@/lib/settlement/settlement-window';
import StatementSheetGateClient from './StatementSheetGateClient';

export const metadata: Metadata = { title: '지급 명세서' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ tyCode: string }>;
  searchParams?: Promise<{ year_month?: string | string[] }>;
}

export default async function PublicStatementSheetPage({ params, searchParams }: PageProps) {
  const { tyCode: rawTyCode } = await params;
  const sp = (await searchParams) ?? {};
  const defaultYearMonth = getSettlementWindowSeoul().label_year_month;
  const requestedYearMonthRaw =
    coalesceYearMonthSearchParam(sp.year_month as string | string[] | undefined) ?? defaultYearMonth;
  const yearMonth = normalizeYearMonthLabel(requestedYearMonthRaw) ?? defaultYearMonth;

  const tyCode = (rawTyCode ?? '').toString().trim();

  return (
    <main className="min-h-[80vh] bg-slate-50 px-3 py-6 sm:px-6 sm:py-10">
      <StatementSheetGateClient tyCode={tyCode} yearMonth={yearMonth} />
    </main>
  );
}
