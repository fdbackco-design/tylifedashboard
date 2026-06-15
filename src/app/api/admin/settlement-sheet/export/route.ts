/**
 * GET /api/admin/settlement-sheet/export?year_month=YYYY-MM
 *
 * 영업자별 지급명세서 공유 링크 목록을 CSV(UTF-8 BOM) 로 응답한다. (Excel 에서 그대로 열림)
 *
 * 컬럼:
 *   A: 전화번호
 *   B: #{고객명}
 *   C: #{직책}
 *   D: #{정산월}
 *   E: #{정산기간}
 *   F: #{링크}
 *
 * - 정산 계산은 일체 변경하지 않는다. monthly_settlements / organization_members 만 조회.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import {
  getSettlementWindowForYearMonth,
  getSettlementWindowDisplayForYearMonth,
  normalizeYearMonthLabel,
} from '@/lib/settlement/settlement-window';
import {
  digitsOnlyPhone,
  formatYearMonthKo,
  formatYmdDot,
} from '@/lib/settlement/statement-sheet';
import {
  loadStatementDownlineSharedData,
  computeStatementDownlineUnitsWithSharedContext,
  loadGlobalStatementWindowContractPool,
} from '@/lib/organization/statement-downline-units';
import type { RankType } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UTF8_BOM = '\uFEFF';

function csvEscape(value: string): string {
  const v = value ?? '';
  if (/[",\n\r]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

/**
 * 전화번호 같은 "앞자리 0이 있는 숫자 문자열" 셀을 엑셀이 숫자로 자동 변환하지 않도록
 * `="01012345678"` 형태로 감싼다. (Excel/한컴오피스에서 텍스트 셀로 인식)
 * 빈 값은 빈 셀로 그대로 두어 정렬·필터에 영향이 없도록 한다.
 */
function csvTextCell(digits: string): string {
  if (!digits) return '';
  return `="${digits.replace(/"/g, '""')}"`;
}

function getAppBaseUrl(req: NextRequest): string {
  const envUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').trim();
  if (envUrl) return envUrl.replace(/\/+$/, '');
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  const host = req.headers.get('host') ?? '';
  if (host) return `${proto}://${host}`;
  return '';
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const ymRaw = (searchParams.get('year_month') ?? '').trim();
  const yearMonth = normalizeYearMonthLabel(ymRaw);
  if (!yearMonth) return NextResponse.json({ error: 'invalid_year_month' }, { status: 400 });

  const displayWindow = getSettlementWindowDisplayForYearMonth(yearMonth);
  const periodKo = `${formatYmdDot(displayWindow.start_date)} ~ ${formatYmdDot(displayWindow.end_date)}`;
  const yearMonthKo = formatYearMonthKo(yearMonth);
  const baseUrl = getAppBaseUrl(req);

  const db = createAdminSupabaseClient();
  const { data: settlements, error: sErr } = await db
    .from('monthly_settlements')
    .select('member_id, direct_unit_count, base_commission, rollup_commission, incentive_amount')
    .eq('year_month', yearMonth);
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });
  const settlementRows = (settlements ?? []) as Array<{
    member_id: string;
    direct_unit_count: number | null;
    base_commission: number | null;
    rollup_commission: number | null;
    incentive_amount: number | null;
  }>;
  const memberIds = settlementRows.map((r) => r.member_id).filter(Boolean);
  if (memberIds.length === 0) {
    return new NextResponse(`${UTF8_BOM}전화번호,고객명,직책,정산월,정산기간,링크\n`, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="statement-sheet-${yearMonth}.csv"`,
      },
    });
  }

  const { data: members, error: mErr } = await db
    .from('organization_members')
    .select('id, name, rank, phone, leader_rank_effective_at')
    .in('id', memberIds);
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });
  const memberById = new Map(
    ((members ?? []) as Array<{
      id: string;
      name: string;
      rank: RankType;
      phone: string | null;
      leader_rank_effective_at: string | null;
    }>).map((m) => [m.id, m]),
  );

  // 관리자 보정값 (settlement_statement_overrides) — 표시값 우선
  const { data: overrideRows, error: oErr } = await db
    .from('settlement_statement_overrides')
    .select('member_id, personal_unit_count, downline_unit_count, personal_commission, override_amount, bonus_amount')
    .eq('year_month', yearMonth)
    .in('member_id', memberIds);
  if (oErr) return NextResponse.json({ error: oErr.message }, { status: 500 });
  const overrideByMemberId = new Map<
    string,
    {
      personal_unit_count: number | null;
      downline_unit_count: number | null;
      personal_commission: number | null;
      override_amount: number | null;
      bonus_amount: number | null;
    }
  >();
  for (const r of ((overrideRows ?? []) as Array<{
    member_id: string;
    personal_unit_count: number | null;
    downline_unit_count: number | null;
    personal_commission: number | null;
    override_amount: number | null;
    bonus_amount: number | null;
  }>)) {
    overrideByMemberId.set(r.member_id, {
      personal_unit_count: r.personal_unit_count,
      downline_unit_count: r.downline_unit_count,
      personal_commission: r.personal_commission,
      override_amount: r.override_amount,
      bonus_amount: r.bonus_amount,
    });
  }

  // 영업자 로그인 ID(=공유 URL 의 tyCode) 매핑 — user_profiles.login_code 기준.
  const { data: profileRows, error: pErr } = await db
    .from('user_profiles')
    .select('member_id, login_code, is_active, updated_at')
    .in('member_id', memberIds)
    .not('login_code', 'is', null)
    .order('is_active', { ascending: false })
    .order('updated_at', { ascending: false });
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  const loginCodeByMemberId = new Map<string, string>();
  for (const p of ((profileRows ?? []) as Array<{
    member_id: string | null;
    login_code: string | null;
  }>)) {
    if (!p.member_id || !p.login_code) continue;
    if (!loginCodeByMemberId.has(p.member_id)) {
      loginCodeByMemberId.set(p.member_id, p.login_code);
    }
  }

  // 산하 실적 구좌 — admin/settlement_sheet 페이지와 동일한 방식으로 일괄 계산.
  const { start_date, end_date } = getSettlementWindowForYearMonth(yearMonth);
  const downlineUnitsByMemberId: Record<string, number> = {};
  {
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

  const rows = settlementRows
    .map((sr) => {
      const m = memberById.get(sr.member_id);
      if (!m) return null;
      const ov = overrideByMemberId.get(sr.member_id) ?? null;
      const personalUnit = ov?.personal_unit_count ?? Number(sr.direct_unit_count ?? 0);
      const downlineUnit = ov?.downline_unit_count ?? (downlineUnitsByMemberId[sr.member_id] ?? 0);
      const personalCommission = ov?.personal_commission ?? Number(sr.base_commission ?? 0);
      const overrideAmount = ov?.override_amount ?? Number(sr.rollup_commission ?? 0);
      const bonusAmount = ov?.bonus_amount ?? Number(sr.incentive_amount ?? 0);
      // 표시값이 모두 0 이면 export 에서도 제외 (페이지와 동일 기준).
      if (
        personalUnit === 0 &&
        downlineUnit === 0 &&
        personalCommission === 0 &&
        overrideAmount === 0 &&
        bonusAmount === 0
      ) {
        return null;
      }
      const name = (m.name ?? '').replace(/^\[고객\]\s*/, '') || '';
      const phoneDigits = digitsOnlyPhone(m.phone);
      const tyCode = (loginCodeByMemberId.get(m.id) ?? '').trim();
      const link =
        tyCode && baseUrl
          ? `${baseUrl}/organization/statement/${encodeURIComponent(tyCode)}?year_month=${encodeURIComponent(yearMonth)}`
          : '';
      return {
        phoneDigits,
        name,
        rank: String(m.rank ?? ''),
        link,
      };
    })
    .filter((x): x is { phoneDigits: string; name: string; rank: string; link: string } => x !== null)
    .sort((a, b) => a.name.localeCompare(b.name, 'ko-KR'));

  const header = ['전화번호', '고객명', '직책', '정산월', '정산기간', '링크'].map(csvEscape).join(',');
  const body = rows
    .map((r) =>
      [
        // 전화번호는 앞자리 0 보존을 위해 ="..." 형식의 텍스트 셀로 출력.
        csvTextCell(r.phoneDigits),
        csvEscape(r.name),
        csvEscape(r.rank),
        csvEscape(yearMonthKo),
        csvEscape(periodKo),
        csvEscape(r.link),
      ].join(','),
    )
    .join('\n');
  const csv = `${UTF8_BOM}${header}\n${body}${body ? '\n' : ''}`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="statement-sheet-${yearMonth}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
