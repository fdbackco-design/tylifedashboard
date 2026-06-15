/**
 * 영업자별 공유 지급명세서 데이터 응답 API.
 *
 * - POST { tyCode, year_month, code }
 *   tyCode 와 사용자가 입력한 code 가 모두 일치하고,
 *   user_profiles.login_code == tyCode (영업자 페이지 로그인 ID) 인 활성 프로필이
 *   있을 때 그 member_id 에 해당하는 명세서 데이터를 응답한다.
 *
 * - 정산 계산 로직은 본 API 에서 변경/실행하지 않는다. monthly_settlements 와
 *   settlement_statement_overrides 의 값을 합쳐 표시용 페이로드만 만든다.
 *
 * - 무차별 대입 방어를 위해 코드 불일치 시 401 + 메시지만 반환. 데이터 일부도 포함하지 않는다.
 */

import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import {
  buildStatementSheetData,
  formatYearMonthKo,
  formatYmdDot,
  type StatementSheetMember,
} from '@/lib/settlement/statement-sheet';
import { normalizeYearMonthLabel } from '@/lib/settlement/settlement-window';
import type { RankType } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function safeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: Request) {
  let body: { tyCode?: unknown; year_month?: unknown; code?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const tyCodeRaw = typeof body.tyCode === 'string' ? body.tyCode.trim() : '';
  const codeRaw = typeof body.code === 'string' ? body.code.trim() : '';
  const ymRaw = typeof body.year_month === 'string' ? body.year_month.trim() : '';

  if (!tyCodeRaw || !codeRaw) {
    return NextResponse.json({ error: 'missing_params' }, { status: 400 });
  }
  const yearMonth = normalizeYearMonthLabel(ymRaw);
  if (!yearMonth) {
    return NextResponse.json({ error: 'invalid_year_month' }, { status: 400 });
  }

  // 사용자가 입력한 code 가 URL 의 tyCode 와 정확히 일치해야 함 (대소문자 포함).
  if (!safeEqualString(tyCodeRaw, codeRaw)) {
    return NextResponse.json({ error: 'code_mismatch' }, { status: 401 });
  }

  const db = createAdminSupabaseClient();

  // 1) tyCode (= 영업자 로그인 ID = user_profiles.login_code) 로 활성 영업자 프로필 조회
  const { data: profileRow, error: profileErr } = await db
    .from('user_profiles')
    .select('member_id, is_active, role')
    .eq('login_code', tyCodeRaw)
    .maybeSingle();
  if (profileErr) {
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
  if (!profileRow) {
    return NextResponse.json({ error: 'member_not_found' }, { status: 404 });
  }
  const memberId = (profileRow as { member_id: string | null }).member_id;
  const isActive = (profileRow as { is_active: boolean | null }).is_active !== false;
  if (!memberId || !isActive) {
    return NextResponse.json({ error: 'member_not_found' }, { status: 404 });
  }

  // 2) 매핑된 organization_members 조회
  const { data: memberRow, error: memberErr } = await db
    .from('organization_members')
    .select('id,name,rank,phone,external_id,leader_rank_effective_at')
    .eq('id', memberId)
    .maybeSingle();
  if (memberErr) {
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
  if (!memberRow) {
    return NextResponse.json({ error: 'member_not_found' }, { status: 404 });
  }

  const member: StatementSheetMember = {
    id: memberRow.id as string,
    name: ((memberRow.name as string) ?? '').replace(/^\[고객\]\s*/, '') || '—',
    rank: memberRow.rank as RankType,
    external_id: (memberRow.external_id as string | null) ?? null,
    phone: (memberRow.phone as string | null) ?? null,
    leader_rank_effective_at: (memberRow.leader_rank_effective_at as string | null) ?? null,
  };

  const data = await buildStatementSheetData(db, yearMonth, member);

  return NextResponse.json({
    ok: true,
    yearMonthLabelKo: formatYearMonthKo(data.labelYearMonth),
    displayWindowKo: `${formatYmdDot(data.displayWindow.start_date)} ~ ${formatYmdDot(data.displayWindow.end_date)}`,
    sheet: {
      name: data.member.name,
      rank: data.member.rank,
      yearMonth: data.labelYearMonth,
      personalUnitCount: data.personalUnitCount,
      downlineUnitCount: data.downlineUnitCount,
      totalUnitCount: data.totalUnitCount,
      personalCommission: data.personalCommission,
      overrideAmount: data.overrideAmount,
      bonusAmount: data.bonusAmount,
      grossTotal: data.grossTotal,
      withholdingTax: data.withholdingTax,
      netPayment: data.netPayment,
    },
  });
}
