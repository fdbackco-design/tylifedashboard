import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { sumDownlineAttributedUnitsInSettlementWindow } from '@/lib/organization/statement-downline-units';
import {
  coalesceYearMonthSearchParam,
  getSettlementWindowForYearMonth,
  getSettlementWindowSeoul,
  normalizeYearMonthLabel,
} from '@/lib/settlement/settlement-window';

export const metadata: Metadata = { title: '지급 명세서' };
export const dynamic = 'force-dynamic';

function formatWon(value: number): string {
  return `${Math.round(value).toLocaleString('ko-KR')} 원`;
}

export default async function OrganizationStatementPage({
  searchParams,
}: {
  searchParams?: Promise<{ year_month?: string; debug?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const debug = String(sp.debug ?? '').trim() === '1';
  const defaultYearMonth = getSettlementWindowSeoul().label_year_month;
  const requestedYearMonthRaw =
    coalesceYearMonthSearchParam(sp.year_month as string | string[] | undefined) ?? defaultYearMonth;
  const yearMonth = normalizeYearMonthLabel(requestedYearMonthRaw) ?? defaultYearMonth;
  const { start_date, end_date, label_year_month } = getSettlementWindowForYearMonth(yearMonth);

  const userDb = await createServerSupabaseClient();
  const {
    data: { user },
  } = await userDb.auth.getUser();

  if (!user) {
    redirect(`/login?redirect=${encodeURIComponent(`/organization/statement?year_month=${yearMonth}`)}`);
  }

  const { data: profile } = await userDb
    .from('user_profiles')
    .select('member_id,is_active')
    .eq('id', user.id)
    .maybeSingle();

  const memberId = (profile?.member_id as string | null) ?? null;
  if (!memberId) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-600">이 계정은 조직도에 연결된 권한(member_id)이 없습니다.</p>
        <Link className="text-sm text-blue-600 underline mt-2 inline-block" href="/organization">
          내 조직도로
        </Link>
      </div>
    );
  }

  const db = createAdminSupabaseClient();

  const [memberRes, settlementRes] = await Promise.all([
    db
      .from('organization_members')
      .select('id,name,rank,leader_rank_effective_at')
      .eq('id', memberId)
      .maybeSingle(),
    db
      .from('monthly_settlements')
      .select(
        'year_month, member_id, rank, direct_unit_count, base_commission, rollup_commission, incentive_amount, total_amount',
      )
      .eq('year_month', label_year_month)
      .eq('member_id', memberId)
      .maybeSingle(),
  ]);

  const member = (memberRes.data ?? null) as {
    id: string;
    name: string;
    rank: string;
    leader_rank_effective_at?: string | null;
  } | null;
  const s = (settlementRes.data ?? null) as
    | {
        year_month: string;
        member_id: string;
        rank: string;
        direct_unit_count: number;
        base_commission: number;
        rollup_commission: number;
        incentive_amount: number;
        total_amount: number;
      }
    | null;

  const displayName = (member?.name ?? '').replace(/^\[고객\]\s*/, '') || '—';
  const rank = s?.rank ?? member?.rank ?? '—';

  if (!s) {
    return (
      <div className="p-6">
        <div className="mb-4">
          <div className="text-xs text-gray-500">
            <Link className="text-blue-600 hover:underline" href={`/organization?year_month=${yearMonth}`}>
              내 조직도
            </Link>
            <span className="mx-1">/</span>
            <span>지급 명세서</span>
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mt-2">지급 명세서</h2>
          <p className="text-sm text-gray-500 mt-1">
            기준 {label_year_month} · {start_date}~{end_date}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <p className="text-sm text-gray-700">
            이 달의 정산 데이터가 아직 계산/저장되지 않았습니다. 관리자 화면(`/admin/settlement`)에서 해당 월 정산 재계산을 실행한 뒤 다시 확인해 주세요.
          </p>
          <div className="mt-4">
            <Link
              className="inline-flex items-center px-3 py-2 text-sm rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              href={`/organization?year_month=${yearMonth}`}
            >
              돌아가기
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const downlineRes = await sumDownlineAttributedUnitsInSettlementWindow(
    db,
    memberId,
    { start_date, end_date },
    s.direct_unit_count ?? 0,
    member?.leader_rank_effective_at ?? null,
    { debug },
  );
  const downlineAttributedUnits =
    typeof downlineRes === 'number' ? downlineRes : downlineRes.downline_units;

  const no = `${label_year_month}-${String(memberId).slice(0, 4)}`;
  const statementTotalUnits = (s.direct_unit_count ?? 0) + downlineAttributedUnits;

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4">
        <div className="text-xs text-gray-500">
          <Link className="text-blue-600 hover:underline" href={`/organization?year_month=${yearMonth}`}>
            내 조직도
          </Link>
          <span className="mx-1">/</span>
          <span>지급 명세서</span>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="border-t-4 border-orange-400 p-5 sm:p-7">
          <div className="flex items-baseline justify-between gap-3 pb-3 border-b border-gray-200 mb-5">
            <h3 className="m-0 text-base font-semibold text-orange-950">지급 명세서</h3>
            <span className="text-xs text-gray-400">No. {no}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
            <div className="bg-orange-50 rounded-lg p-3.5 border border-orange-100">
              <div className="text-xs text-orange-800 mb-1">이름</div>
              <div className="text-sm font-semibold text-orange-950">{displayName}</div>
            </div>
            <div className="bg-orange-50 rounded-lg p-3.5 border border-orange-100">
              <div className="text-xs text-orange-800 mb-1">직급</div>
              <div className="text-sm font-semibold text-orange-950">{rank}</div>
            </div>
            <div className="bg-orange-50 rounded-lg p-3.5 border border-orange-100">
              <div className="text-xs text-orange-800 mb-1">기간</div>
              <div className="text-sm font-semibold text-orange-950">{label_year_month}</div>
              <div className="text-[11px] text-orange-900/60 mt-0.5">
                {start_date}~{end_date}
              </div>
            </div>
          </div>

          <div className="text-sm font-semibold text-orange-800 mb-2">기간 내 실적</div>
          <div className="rounded-lg border border-gray-200 overflow-hidden mb-5">
            <div className="grid grid-cols-2 px-4 py-3 border-b border-gray-100">
              <div className="text-sm text-gray-600">개인 실적 구좌</div>
              <div className="text-sm text-right font-semibold tabular-nums">{s.direct_unit_count.toLocaleString('ko-KR')} 구좌</div>
            </div>
            <div className="grid grid-cols-2 px-4 py-3 border-b border-gray-100">
              <div className="text-sm text-gray-600">산하 실적 구좌</div>
              <div className="text-sm text-right font-semibold tabular-nums">
                {downlineAttributedUnits.toLocaleString('ko-KR')} 구좌
              </div>
            </div>
          </div>

          {debug && typeof downlineRes !== 'number' ? (
            <div className="rounded-lg border border-gray-200 overflow-hidden mb-5">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                <div className="text-sm font-semibold text-gray-800">산하 실적 집계 디버그</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  포함된 계약(및 제외된 계약 일부)을 확인합니다.
                </div>
                <div className="text-xs text-gray-600 mt-2">
                  포함 합계(개인 차감 전){' '}
                  <span className="font-semibold tabular-nums">
                    {downlineRes.included_units_before_personal.toLocaleString('ko-KR')}
                  </span>
                  구좌 · 개인(정산){' '}
                  <span className="font-semibold tabular-nums">
                    {downlineRes.personal_units_from_settlement.toLocaleString('ko-KR')}
                  </span>
                  구좌 · 최종 산하{' '}
                  <span className="font-semibold tabular-nums">
                    {downlineRes.downline_units.toLocaleString('ko-KR')}
                  </span>
                  구좌
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr className="text-left text-xs text-gray-600">
                      {['가입일', '계약', '구좌', '원본 담당자', '귀속 담당자', '가까운 하위 리더', '비고'].map((h) => (
                        <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {downlineRes.debug_rows.slice(0, 300).map((r) => (
                      <tr key={r.contract_id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-700">
                          {r.join_date}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="font-mono text-xs text-gray-800">
                            {r.contract_code ?? r.contract_id}
                          </span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums text-right">
                          {Number(r.unit_count ?? 0).toLocaleString('ko-KR')}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-700">
                          {(r.raw_sales_member_name ?? r.raw_sales_member_id).replace(/^\[고객\]\s*/, '')}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-700">
                          {(r.origin_member_name ?? r.origin_member_id).replace(/^\[고객\]\s*/, '')}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-700">
                          {r.nearest_leader_id
                            ? (r.nearest_leader_name ?? r.nearest_leader_id).replace(/^\[고객\]\s*/, '')
                            : '-'}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-xs">
                          {r.excluded_by_root_leader_effective_at ? (
                            <span className="text-amber-700">리더 전 계약 제외</span>
                          ) : r.excluded_by_leader_after_promotion ? (
                            <span className="text-amber-700">하위 리더 승격 이후 제외</span>
                          ) : (
                            <span className="text-emerald-700">포함</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {downlineRes.debug_rows.length > 300 ? (
                <div className="px-4 py-2 text-xs text-gray-500">
                  {downlineRes.debug_rows.length.toLocaleString('ko-KR')}건 중 300건만 표시했습니다.
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="text-sm font-semibold text-orange-800 mb-2">지급 내역</div>
          <div className="rounded-lg border border-gray-200 overflow-hidden mb-5">
            <div className="grid grid-cols-2 px-4 py-3 border-b border-gray-100">
              <div className="text-sm text-gray-600">개인 수당</div>
              <div className="text-sm text-right tabular-nums">{formatWon(s.base_commission ?? 0)}</div>
            </div>
            <div className="grid grid-cols-2 px-4 py-3 border-b border-gray-100">
              <div className="text-sm text-gray-600">오버라이드</div>
              <div className="text-sm text-right tabular-nums">{formatWon(s.rollup_commission ?? 0)}</div>
            </div>
            <div className="grid grid-cols-2 px-4 py-3">
              <div className="text-sm text-gray-600">보너스</div>
              <div className="text-sm text-right tabular-nums">{formatWon(s.incentive_amount ?? 0)}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-orange-400 rounded-lg p-4">
              <div className="text-xs text-orange-950/80 mb-1">총 지급액</div>
              <div className="text-xl font-semibold text-orange-950 tabular-nums">{formatWon(s.total_amount ?? 0)}</div>
            </div>
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
              <div className="text-xs text-orange-800 mb-1">총 합계 구좌</div>
              <div className="text-xl font-semibold text-orange-950 tabular-nums">
                {statementTotalUnits.toLocaleString('ko-KR')} 구좌
              </div>
            </div>
          </div>

          <div className="mt-6">
            <Link
              className="inline-flex items-center px-3 py-2 text-sm rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              href={`/organization?year_month=${yearMonth}`}
            >
              내 조직도로 돌아가기
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

