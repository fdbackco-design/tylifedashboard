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
  getSettlementWindowDisplayForYearMonth,
  normalizeYearMonthLabel,
} from '@/lib/settlement/settlement-window';
import {
  digitsOnlyPhone,
  formatYearMonthKo,
  formatYmdDot,
} from '@/lib/settlement/statement-sheet';
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
    .select('member_id')
    .eq('year_month', yearMonth);
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });
  const memberIds = ((settlements ?? []) as Array<{ member_id: string }>)
    .map((r) => r.member_id)
    .filter(Boolean);
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
    .select('id, name, rank, phone, external_id')
    .in('id', memberIds);
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

  const rows = ((members ?? []) as Array<{
    id: string;
    name: string;
    rank: RankType;
    phone: string | null;
    external_id: string | null;
  }>)
    .map((m) => {
      const name = (m.name ?? '').replace(/^\[고객\]\s*/, '') || '';
      const phoneDigits = digitsOnlyPhone(m.phone);
      const tyCode = (m.external_id ?? '').trim();
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
    .sort((a, b) => a.name.localeCompare(b.name, 'ko-KR'));

  const header = ['전화번호', '고객명', '직책', '정산월', '정산기간', '링크'].map(csvEscape).join(',');
  const body = rows
    .map((r) =>
      [r.phoneDigits, r.name, r.rank, yearMonthKo, periodKo, r.link].map(csvEscape).join(','),
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
