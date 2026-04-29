import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { isAdminAuthed } from '@/lib/admin-auth';

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAdminAuthed(req)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const customerId = String(req.nextUrl.searchParams.get('customer_id') ?? '').trim();
  if (!customerId) return NextResponse.json({ success: false, error: 'customer_id required' }, { status: 400 });

  const db = createAdminSupabaseClient();

  try {
    // 1) source_customer_id 기준(대부분의 경우 employee 노드에 매핑되어 있음)
    const { data: bySource } = await db
      .from('organization_members')
      .select('id, name, rank, phone, source_customer_id, external_id')
      .eq('source_customer_id', customerId)
      .neq('rank', '본사')
      .limit(50);

    // 2) customer:{id} external_id 기준(임시/과거 데이터 보정용)
    const { data: byExternal } = await db
      .from('organization_members')
      .select('id, name, rank, phone, source_customer_id, external_id')
      .eq('external_id', `customer:${customerId}`)
      .limit(50);

    const a = (bySource ?? []) as any[];
    const b = (byExternal ?? []) as any[];
    const map = new Map<string, any>();
    for (const m of [...a, ...b]) map.set(m.id as string, m);
    const rows = [...map.values()].sort((x, y) => String(x.rank ?? '').localeCompare(String(y.rank ?? '')));

    return NextResponse.json({ success: true, data: rows });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

