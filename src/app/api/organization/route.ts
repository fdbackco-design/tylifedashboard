/**
 * GET /api/organization
 * 조직 트리 조회.
 * ?root_id=UUID: 특정 멤버 하위 트리. 미지정 시 전체 트리.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { buildOrgTree } from '@/lib/settlement/calculator';
import { calculateMonthlySettlement } from '@/lib/settlement/monthly-calculate';
import type { OrgTreeRow } from '@/lib/types';

// Route Handler 캐시 (URL 단위) — 조직도는 변경 빈도가 낮음
export const revalidate = 60;
export const dynamic = 'force-static';

function getEffectiveStartYearMonthSeoul(): string {
  // 규칙: 오늘(Seoul) 날짜가 26일 이상이면 "다음달"을 적용 시작월로,
  // 25일 이하면 "이번달"을 적용 시작월로 사용한다.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parseInt(parts.find((p) => p.type === 'year')?.value ?? '0', 10);
  const m = parseInt(parts.find((p) => p.type === 'month')?.value ?? '0', 10);
  const d = parseInt(parts.find((p) => p.type === 'day')?.value ?? '0', 10);

  if (!y || !m || !d) return ''; // fallback (이 값이 내려가면 아래 validation에서 걸림)

  if (d >= 26) {
    const nextY = m === 12 ? y + 1 : y;
    const nextM = m === 12 ? 1 : m + 1;
    return `${nextY}-${String(nextM).padStart(2, '0')}`;
  }

  return `${y}-${String(m).padStart(2, '0')}`;
}

async function wouldCreateCycle(params: {
  db: ReturnType<typeof createAdminSupabaseClient>;
  parentId: string | null;
  childId: string;
}): Promise<boolean> {
  const { db, parentId, childId } = params;
  if (!parentId) return false;
  if (parentId === childId) return true;

  const visited = new Set<string>();
  let cur: string | null = parentId;
  while (cur) {
    if (cur === childId) return true;
    if (visited.has(cur)) return true;
    visited.add(cur);
    const res = await db
      .from('organization_edges')
      .select('parent_id')
      .eq('child_id', cur)
      .maybeSingle();
    if (res.error) throw new Error(`organization_edges 조회 실패: ${res.error.message}`);
    const edgeRow = (res.data ?? null) as { parent_id: string | null } | null;
    cur = edgeRow?.parent_id ?? null;
  }
  return false;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const rootId = req.nextUrl.searchParams.get('root_id');
  const db = createAdminSupabaseClient();

  let rows: OrgTreeRow[];

  if (rootId) {
    // DB 함수로 특정 루트의 하위 트리 조회
    const { data, error } = await db.rpc('get_org_tree', {
      p_root_id: rootId,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    rows = (data as OrgTreeRow[]) ?? [];
  } else {
    // 전체 조직원 + edges 조회 후 트리 빌드
    const [membersRes, edgesRes] = await Promise.all([
      db
        .from('organization_members')
        .select('id, name, rank')
        .eq('is_active', true)
        .order('name'),
      db.from('organization_edges').select('parent_id, child_id'),
    ]);

    if (membersRes.error) {
      return NextResponse.json({ error: membersRes.error.message }, { status: 500 });
    }

    // flat 구조 → OrgTreeRow 변환
    const edgeMap = new Map<string, string | null>();
    for (const edge of edgesRes.data ?? []) {
      edgeMap.set(
        (edge as { child_id: string; parent_id: string | null }).child_id,
        (edge as { child_id: string; parent_id: string | null }).parent_id,
      );
    }

    rows = (membersRes.data ?? []).map((m, idx) => ({
      id: (m as { id: string }).id,
      name: (m as { name: string }).name,
      rank: (m as { rank: string }).rank as OrgTreeRow['rank'],
      parent_id: edgeMap.get((m as { id: string }).id) ?? null,
      depth: 0, // buildOrgTree가 재귀로 처리
    }));
  }

  const tree = buildOrgTree(rows);
  return NextResponse.json({ data: tree });
}

/**
 * PATCH /api/organization
 * 조직 관계(부모) 변경 + 오늘 기준 월(YYYY-MM)부터 정산 재계산 트리거
 *
 * body: { child_id: UUID, parent_id: UUID|null }
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  // 캐시/정적 라우트로 굳어지지 않도록
  const db = createAdminSupabaseClient();

  let body: { child_id?: string; parent_id?: string | null } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON body 필요' }, { status: 400 });
  }

  const childId = (body.child_id ?? '').trim();
  const parentId = body.parent_id == null ? null : String(body.parent_id).trim();
  const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

  if (!childId || !isUuid(childId)) return NextResponse.json({ error: 'child_id(UUID) 필요' }, { status: 400 });
  if (parentId != null && !isUuid(parentId)) return NextResponse.json({ error: 'parent_id는 UUID 또는 null' }, { status: 400 });
  if (parentId === childId) return NextResponse.json({ error: 'self-loop는 허용되지 않습니다.' }, { status: 400 });

  // cycle 방지
  try {
    const cycle = await wouldCreateCycle({ db, parentId, childId });
    if (cycle) return NextResponse.json({ error: 'cycle(순환) 관계는 허용되지 않습니다.' }, { status: 409 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  // edge upsert
  const { error: upErr } = await db
    .from('organization_edges')
    .upsert(
      { child_id: childId, parent_id: parentId, is_manual: true, manual_updated_at: new Date().toISOString() } as any,
      { onConflict: 'child_id' },
    );
  if (upErr) return NextResponse.json({ error: `organization_edges 업데이트 실패: ${upErr.message}` }, { status: 500 });

  // 적용 시작월 규칙(Seoul): 26일~말일 => 다음달, 1일~25일 => 이번달
  const yearMonth = getEffectiveStartYearMonthSeoul();
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    return NextResponse.json({ error: '적용 시작월 계산 실패' }, { status: 500 });
  }
  let settlement: { recalculated: boolean; updated_count?: number; skipped_reason?: string } = { recalculated: false };

  // 확정된 정산이면 강제로 덮어쓰지 않는다(안전).
  const { data: finalized } = await db
    .from('monthly_settlements')
    .select('id')
    .eq('year_month', yearMonth)
    .eq('is_finalized', true)
    .limit(1);
  if (finalized && finalized.length > 0) {
    settlement = { recalculated: false, skipped_reason: `${yearMonth} 정산이 확정되어 재계산을 건너뛰었습니다.` };
  } else {
    try {
      const result = await calculateMonthlySettlement({ yearMonth, db });
      settlement = { recalculated: true, updated_count: result.updated_count };
    } catch (e) {
      // 조직 변경은 성공했지만 재계산만 실패할 수 있음 → 클라이언트에서 메시지 표시
      settlement = { recalculated: false, skipped_reason: e instanceof Error ? e.message : String(e) };
    }
  }

  return NextResponse.json({ success: true, year_month: yearMonth, settlement });
}
