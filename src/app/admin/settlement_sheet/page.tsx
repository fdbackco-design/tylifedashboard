/**
 * /admin/settlement_sheet
 *
 * 영업자별 지급명세서(공유 링크용) 관리자 페이지.
 *
 * - 정산월 선택 → 해당 월 monthly_settlements 가 있는 모든 영업자 목록을 표시.
 * - 관리자가 표시값(개인 실적 구좌 / 산하 실적 구좌 / 개인 수당 / 오버라이드 / 보너스) 을
 *   수정하여 settlement_statement_overrides 에 저장할 수 있다.
 * - 영업자별 공유 URL 과 엑셀(CSV) 다운로드를 제공한다.
 *
 * 정산 계산 로직(monthly_settlements 생성)은 본 페이지에서 변경하지 않는다.
 * 본 페이지는 표시·보정 전용 (`settlement_statement_overrides` 만 R/W).
 */

import type { Metadata } from 'next';
import YearMonthSelector from '@/components/YearMonthSelector';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import {
  coalesceYearMonthSearchParam,
  getSettlementWindowForYearMonth,
  getSettlementWindowSeoul,
  getSettlementWindowDisplayForYearMonth,
  normalizeYearMonthLabel,
} from '@/lib/settlement/settlement-window';
import {
  loadStatementDownlineSharedData,
  computeStatementDownlineUnitsWithSharedContext,
  loadGlobalStatementWindowContractPool,
} from '@/lib/organization/statement-downline-units';
import { isSuppressedStatementSheetMember, resolveLoginCodesForMembers, resolveStatementPhonesByMemberId, hasStatementPayoutAmount } from '@/lib/settlement/statement-sheet';
import type { RankType } from '@/lib/types';
import SettlementSheetAdminClient, {
  type SheetRowVM,
} from './SettlementSheetAdminClient';

export const metadata: Metadata = { title: '명세서 관리' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Promise<{ year_month?: string | string[] }>;
}

export default async function AdminSettlementSheetPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const defaultYearMonth = getSettlementWindowSeoul().label_year_month;
  const yearMonth =
    normalizeYearMonthLabel(
      coalesceYearMonthSearchParam(sp.year_month as string | string[] | undefined) ?? defaultYearMonth,
    ) ?? defaultYearMonth;
  const { start_date, end_date, label_year_month } = getSettlementWindowForYearMonth(yearMonth);
  const displayWindow = getSettlementWindowDisplayForYearMonth(yearMonth);

  const yearsForPicker = (() => {
    const base = parseInt(label_year_month.slice(0, 4), 10);
    const out: number[] = [];
    for (let y = base; y >= base - 4; y--) out.push(y);
    return out;
  })();

  const db = createAdminSupabaseClient();

  const { data: settlements } = await db
    .from('monthly_settlements')
    .select('member_id, rank, direct_unit_count, base_commission, rollup_commission, incentive_amount, total_amount')
    .eq('year_month', label_year_month);
  const settlementRows = (settlements ?? []) as Array<{
    member_id: string;
    rank: RankType;
    direct_unit_count: number | null;
    base_commission: number | null;
    rollup_commission: number | null;
    incentive_amount: number | null;
    total_amount: number | null;
  }>;
  const memberIds = settlementRows.map((r) => r.member_id).filter(Boolean);

  let members: Array<{
    id: string;
    name: string;
    rank: RankType;
    phone: string | null;
    external_id: string | null;
    source_customer_id: string | null;
    leader_rank_effective_at: string | null;
  }> = [];
  if (memberIds.length > 0) {
    const { data } = await db
      .from('organization_members')
      .select('id, name, rank, phone, external_id, source_customer_id, leader_rank_effective_at')
      .in('id', memberIds);
    members = (data ?? []) as typeof members;
  }
  const memberById = new Map(members.map((m) => [m.id, m]));

  // 영업자 로그인 ID(=TY 전산코드) 매핑 — primary(member_id)/fallback(customer_id, phone8) 다단계 시도.
  // 후보가 2건 이상이면 ambiguous 로 분류해 진단 UI 에 경고로 노출한다.
  const { loginCodeByMemberId, ambiguousMemberIds } =
    memberIds.length > 0
      ? await resolveLoginCodesForMembers(db, members)
      : { loginCodeByMemberId: new Map<string, string>(), ambiguousMemberIds: new Set<string>() };
  const phoneByMemberId =
    memberIds.length > 0
      ? await resolveStatementPhonesByMemberId(db, members, loginCodeByMemberId)
      : new Map<string, string>();

  const { data: overrideRows } = await db
    .from('settlement_statement_overrides')
    .select('id, year_month, member_id, personal_unit_count, downline_unit_count, personal_commission, override_amount, bonus_amount, memo, updated_at')
    .eq('year_month', label_year_month);
  const overrideByMemberId = new Map<
    string,
    {
      id: string;
      personal_unit_count: number | null;
      downline_unit_count: number | null;
      personal_commission: number | null;
      override_amount: number | null;
      bonus_amount: number | null;
      memo: string | null;
    }
  >();
  for (const r of (overrideRows ?? []) as Array<{
    id: string;
    member_id: string;
    personal_unit_count: number | null;
    downline_unit_count: number | null;
    personal_commission: number | null;
    override_amount: number | null;
    bonus_amount: number | null;
    memo: string | null;
  }>) {
    overrideByMemberId.set(r.member_id, {
      id: r.id,
      personal_unit_count: r.personal_unit_count,
      downline_unit_count: r.downline_unit_count,
      personal_commission: r.personal_commission,
      override_amount: r.override_amount,
      bonus_amount: r.bonus_amount,
      memo: r.memo,
    });
  }

  // 산하 실적 구좌 일괄 계산 (admin/settlement 와 동일한 글로벌 풀 사용으로 비용 최적화)
  const downlineUnitsByMemberId: Record<string, number> = {};
  if (memberIds.length > 0) {
    const sharedDownline = await loadStatementDownlineSharedData(db);
    const window = { start_date, end_date };
    const preloadedGlobalPool = await loadGlobalStatementWindowContractPool(db, sharedDownline, window);
    const BATCH = 48;
    for (let i = 0; i < memberIds.length; i += BATCH) {
      const slice = memberIds.slice(i, i + BATCH);
      const direct = slice.map((mid) => {
        const row = settlementRows.find((r) => r.member_id === mid);
        return Math.max(0, Math.floor(Number(row?.direct_unit_count ?? 0) || 0));
      });
      const results = await Promise.all(
        slice.map((mid, j) =>
          computeStatementDownlineUnitsWithSharedContext(
            db,
            sharedDownline,
            mid,
            window,
            direct[j],
            memberById.get(mid)?.leader_rank_effective_at ?? null,
            { preloadedGlobalPool },
          ),
        ),
      );
      slice.forEach((mid, j) => {
        const res = results[j];
        downlineUnitsByMemberId[mid] = typeof res === 'number' ? res : res.downline_units;
      });
    }
  }

  const rows: SheetRowVM[] = settlementRows
    .map((r) => {
      const member = memberById.get(r.member_id);
      if (!member) return null;
      const ov = overrideByMemberId.get(r.member_id) ?? null;
      const directBase = Number(r.direct_unit_count ?? 0);
      const downlineBase = downlineUnitsByMemberId[r.member_id] ?? 0;
      const baseBase = Number(r.base_commission ?? 0);
      const rollupBase = Number(r.rollup_commission ?? 0);
      const incentiveBase = Number(r.incentive_amount ?? 0);
      return {
        memberId: member.id,
        name: (member.name ?? '').replace(/^\[고객\]\s*/, '') || '—',
        rank: member.rank,
        phone: phoneByMemberId.get(member.id) || member.phone || '',
        // TY 전산코드(공유 URL/명세서 인증) = 영업자 로그인 ID = user_profiles.login_code
        tyCode: loginCodeByMemberId.get(member.id) ?? '',
        base: {
          personalUnitCount: directBase,
          downlineUnitCount: downlineBase,
          personalCommission: baseBase,
          overrideAmount: rollupBase,
          bonusAmount: incentiveBase,
        },
        override: ov
          ? {
              id: ov.id,
              personalUnitCount: ov.personal_unit_count,
              downlineUnitCount: ov.downline_unit_count,
              personalCommission: ov.personal_commission,
              overrideAmount: ov.override_amount,
              bonusAmount: ov.bonus_amount,
              memo: ov.memo ?? '',
            }
          : null,
      } satisfies SheetRowVM;
    })
    .filter((x): x is SheetRowVM => x !== null)
    // 선택월 수당(개인+오버라이드+보너스)이 0원이면 표·링크·엑셀에서 제외.
    .filter((r) =>
      hasStatementPayoutAmount({
        personalCommission: r.override?.personalCommission ?? r.base.personalCommission,
        overrideAmount: r.override?.overrideAmount ?? r.base.overrideAmount,
        bonusAmount: r.override?.bonusAmount ?? r.base.bonusAmount,
      }),
    )
    // 공유 링크(=login_code) 가 없으면 명세서 공유가 불가능하므로 표·엑셀에서 제외한다.
    .filter((r) => Boolean(r.tyCode))
    // 운영팀 요청으로 노출 차단된 멤버는 표·엑셀에서 제외.
    .filter((r) => !isSuppressedStatementSheetMember(r.name, r.phone))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko-KR'));

  return (
    <div className="p-3 sm:p-6">
      <section className="mb-3 overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-3 shadow-sm ring-1 ring-slate-900/[0.035] sm:mb-4 sm:p-4">
        <div className="mb-3 flex flex-col gap-1 border-b border-slate-100 pb-3 sm:flex-row sm:items-baseline sm:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-orange-700/85">관리자</p>
            <h1 className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
              명세서 관리 · {label_year_month}
            </h1>
            <p className="mt-1 text-[11px] text-slate-500 sm:text-xs">
              정산 구간 {displayWindow.start_date} ~ {displayWindow.end_date}
            </p>
          </div>
          <YearMonthSelector
            layout="compact-toolbar"
            value={label_year_month}
            todayValue={defaultYearMonth}
            years={yearsForPicker}
            todayLabel="오늘 기준월"
          />
        </div>
        <SettlementSheetAdminClient
          yearMonth={label_year_month}
          yearMonthLabelKo={(() => {
            const [yy, mm] = label_year_month.split('-');
            return `${yy}년 ${parseInt(mm, 10)}월`;
          })()}
          displayWindowKo={`${displayWindow.start_date.replace(/-/g, '.')} ~ ${displayWindow.end_date.replace(/-/g, '.')}`}
          rows={rows}
        />
      </section>
    </div>
  );
}
