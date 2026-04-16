import type { Metadata } from 'next';
import Link from 'next/link';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { formatKRW } from '@/lib/settlement/calculator';
import { getSettlementWindowForYearMonth } from '@/lib/settlement/settlement-window';
import { BASE_AMOUNT_PER_UNIT } from '@/lib/settlement/constants';
import type { RankType } from '@/lib/types';
import RecalcButton from './RecalcButton';

export const metadata: Metadata = { title: '정산 현황' };
export const dynamic = 'force-dynamic';

const RANKS: RankType[] = ['영업사원', '리더', '센터장', '사업본부장'];

interface PageProps {
  searchParams: Promise<{
    year_month?: string;
    rank?: string;
    member_id?: string;
  }>;
}

function getCurrentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function nextDay(dateYmd: string): string {
  const [y, m, d] = dateYmd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export default async function SettlementPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const yearMonth = params.year_month ?? getCurrentYearMonth();
  const rankFilter = params.rank as RankType | undefined;

  const db = createAdminSupabaseClient();

  // 해당 월 계약 현황 (정산 대상 여부 파악용)
  // 목록 전체를 내려받지 말고 count만 조회 (빠름)
  const { start_date, end_date } = getSettlementWindowForYearMonth(yearMonth);
  const endExclusive = nextDay(end_date);

  const [allCountRes, eligibleCountRes, kpiRes] = await Promise.all([
    db
      .from('contracts')
      .select('id', { head: true, count: 'estimated' })
      .gte('join_date', start_date)
      .lt('join_date', endExclusive),
    db
      // 정산 대상 계약 수: “가입 인정 기준” (SSOT) 과 동일하게
      // DB view(v_contract_settlement_base)는 동일 기준으로 필터링되어야 함
      .from('v_contract_settlement_base')
      .select('contract_id', { head: true, count: 'estimated' })
      .eq('year_month', yearMonth),
    db.rpc('get_organization_kpis', { p_start_date: start_date, p_end_date: end_date }),
  ]);

  const allContractsCount = allCountRes.count ?? 0;
  const eligibleContractsCount = eligibleCountRes.count ?? 0;

  let query = db
    .from('monthly_settlements')
    .select(
      `
      id,
      year_month,
      member_id,
      rank,
      direct_contract_count,
      direct_unit_count,
      subordinate_unit_count,
      total_unit_count,
      base_commission,
      rollup_commission,
      incentive_amount,
      total_amount,
      is_finalized,
      organization_members(name)
      `,
    )
    .eq('year_month', yearMonth)
    .order('total_amount', { ascending: false });

  if (rankFilter) query = query.eq('rank', rankFilter);

  const { data: settlements, error } = await query;

  if (error) {
    return (
      <div className="p-6">
        <p className="text-red-600 text-sm">정산 데이터 조회 실패: {error.message}</p>
      </div>
    );
  }

  const ZERO_OUT_MEMBER_NAME = '정성은';

  const isZeroOutMember = (s: any): boolean => {
    const member = s.organization_members as unknown as { name?: string } | null;
    return (member?.name ?? '') === ZERO_OUT_MEMBER_NAME;
  };

  const totalAmount = (settlements ?? []).reduce(
    (sum, s) => sum + (isZeroOutMember(s) ? 0 : (s.total_amount as number)),
    0,
  );

  const kpiRow = ((kpiRes.data ?? [])[0] ?? null) as
    | { total_join_units: number; period_join_units: number }
    | null;
  const totalJoinUnits = kpiRow?.total_join_units ?? 0;
  const periodJoinUnits = kpiRow?.period_join_units ?? 0;
  const totalSales = totalJoinUnits * BASE_AMOUNT_PER_UNIT;
  const periodSales = periodJoinUnits * BASE_AMOUNT_PER_UNIT;
  const profit = periodSales - totalAmount;

  // 월 목록 (최근 12개월)
  const months: string[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">정산 현황</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {yearMonth} · 합계 {formatKRW(totalAmount)}
          </p>
          {allContractsCount > 0 && (
            <p className="text-xs text-gray-400 mt-0.5">
              {yearMonth} 계약 {allContractsCount}건 중{' '}
              <span
                className={
                  eligibleContractsCount > 0
                    ? 'text-green-600 font-medium'
                    : 'text-amber-600 font-medium'
                }
              >
                정산 대상 {eligibleContractsCount}건
              </span>
              {eligibleContractsCount === 0 && (
                <> (가입 상태 기준)</>
              )}
            </p>
          )}
        </div>

        <div className="flex items-start gap-3">
          {/* KPI (오른쪽) */}
          <div className="hidden md:grid grid-cols-3 gap-2">
            <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm shadow-sm">
              <div className="text-[11px] text-gray-500">총 매출</div>
              <div className="font-bold text-gray-800 tabular-nums">{formatKRW(totalSales)}</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm shadow-sm">
              <div className="text-[11px] text-gray-500">이번달 매출</div>
              <div className="font-bold text-gray-800 tabular-nums">{formatKRW(periodSales)}</div>
              <div className="text-[10px] text-gray-400 mt-0.5">
                기준 {start_date}~{end_date}
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm shadow-sm">
              <div className="text-[11px] text-gray-500">수익</div>
              <div className={`font-bold tabular-nums ${profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                {formatKRW(profit)}
              </div>
              <div className="text-[10px] text-gray-400 mt-0.5">
                이번달 매출 - 정산금 합계
              </div>
            </div>
          </div>

          <RecalcButton yearMonth={yearMonth} />
        </div>
      </div>

      {/* 필터 */}
      <div className="flex gap-3 mb-5 flex-wrap items-center">
        {/* 월 선택 */}
        <div className="flex gap-1">
          {months.map((m) => (
            <Link
              key={m}
              href={`/settlement?year_month=${m}${rankFilter ? `&rank=${rankFilter}` : ''}`}
              className={`px-2.5 py-1 rounded text-xs border ${m === yearMonth ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'}`}
            >
              {m.slice(5)}월
            </Link>
          ))}
        </div>

        <span className="text-gray-300">|</span>

        {/* 직급 필터 */}
        <Link
          href={`/settlement?year_month=${yearMonth}`}
          className={`px-3 py-1 rounded text-xs border ${!rankFilter ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-gray-600 border-gray-300'}`}
        >
          전체
        </Link>
        {RANKS.map((r) => (
          <Link
            key={r}
            href={`/settlement?year_month=${yearMonth}&rank=${r}`}
            className={`px-3 py-1 rounded text-xs border ${rankFilter === r ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-gray-600 border-gray-300'}`}
          >
            {r}
          </Link>
        ))}
      </div>

      {/* 정산 테이블 */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {[
                  '담당자',
                  '직급',
                  '직접계약',
                  '직접구좌',
                  '산하구좌',
                  '기본수당',
                  '롤업수당',
                  '장려금',
                  '합계',
                  '확정',
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-semibold text-gray-600 whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(settlements ?? []).length === 0 && (
                <tr>
                  <td colSpan={10} className="px-6 py-10 text-center">
                    <p className="text-gray-500 font-medium mb-2">{yearMonth} 정산 데이터가 없습니다.</p>
                    {allContractsCount === 0 ? (
                      <p className="text-xs text-gray-400">
                        이 달에 저장된 계약이 없습니다.{' '}
                        <span className="font-medium">조직도 페이지</span>에서 TY Life 동기화를 먼저 실행하세요.
                      </p>
                    ) : eligibleContractsCount === 0 ? (
                      <p className="text-xs text-amber-600">
                        {allContractsCount}건의 계약이 있지만 정산 대상(가입 인정 기준)이 0건입니다.
                        <br />
                        정산 계산은 <strong>가입 상태 기준</strong>으로 계약을 포함합니다.
                      </p>
                    ) : (
                      <p className="text-xs text-gray-400">
                        위 &apos;{yearMonth} 정산 재계산&apos; 버튼을 눌러 정산을 계산하세요.
                      </p>
                    )}
                  </td>
                </tr>
              )}
              {(settlements ?? []).map((s) => {
                const member = s.organization_members as unknown as { name: string } | null;
                const zeroOut = (member?.name ?? '') === ZERO_OUT_MEMBER_NAME;
                return (
                  <tr key={s.id as string} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">
                      <Link
                        href={`/settlement?year_month=${yearMonth}&member_id=${s.member_id}`}
                        className="text-blue-600 hover:underline"
                      >
                        {member?.name ?? '-'}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{s.rank as string}</td>
                    <td className="px-4 py-3 tabular-nums text-right">
                      {(s.direct_contract_count as number).toLocaleString()}건
                    </td>
                    <td className="px-4 py-3 tabular-nums text-right">
                      {(s.direct_unit_count as number).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-right">
                      {(s.subordinate_unit_count as number).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-right text-gray-700">
                      {formatKRW(zeroOut ? 0 : (s.base_commission as number))}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-right text-gray-700">
                      {formatKRW(zeroOut ? 0 : (s.rollup_commission as number))}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-right text-indigo-700">
                      {formatKRW(zeroOut ? 0 : (s.incentive_amount as number))}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-right font-bold text-gray-900">
                      {formatKRW(zeroOut ? 0 : (s.total_amount as number))}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {s.is_finalized ? (
                        <span className="text-green-600 text-xs font-semibold">확정</span>
                      ) : (
                        <span className="text-gray-300 text-xs">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {(settlements ?? []).length > 0 && (
              <tfoot className="border-t-2 border-gray-200 bg-gray-50">
                <tr>
                  <td colSpan={5} className="px-4 py-3 font-semibold text-gray-700">
                    합계
                  </td>
                  <td className="px-4 py-3 tabular-nums text-right font-semibold">
                    {formatKRW((settlements ?? []).reduce((s, r) => s + (isZeroOutMember(r) ? 0 : (r.base_commission as number)), 0))}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-right font-semibold">
                    {formatKRW((settlements ?? []).reduce((s, r) => s + (isZeroOutMember(r) ? 0 : (r.rollup_commission as number)), 0))}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-right font-semibold text-indigo-700">
                    {formatKRW((settlements ?? []).reduce((s, r) => s + (isZeroOutMember(r) ? 0 : (r.incentive_amount as number)), 0))}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-right font-bold text-gray-900">
                    {formatKRW(totalAmount)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
