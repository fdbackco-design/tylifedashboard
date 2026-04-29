import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { isAdminAuthed } from '@/lib/admin-auth';

function normalizePhoneDigits(v: string): string {
  return v.replace(/\D/g, '');
}

function memberToCustomerId(m: { source_customer_id: string | null; external_id: string | null }): string | null {
  if (m.source_customer_id) return m.source_customer_id;
  const ext = m.external_id ?? '';
  if (ext.startsWith('customer:')) return ext.slice('customer:'.length) || null;
  return null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAdminAuthed(req)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const q = req.nextUrl.searchParams.get('query')?.trim() ?? '';
  if (!q) return NextResponse.json({ success: true, data: [] as any[] });

  const digits = normalizePhoneDigits(q);

  const db = createAdminSupabaseClient();

  try {
    // 요구사항: 검색은 customers가 아니라 organization_members 기준
    const [membersByNameRes, membersByPhoneRes] = await Promise.all([
      db
        .from('organization_members')
        .select('id, name, rank, phone, source_customer_id, external_id')
        .ilike('name', `%${q}%`)
        .limit(30),
      db
        .from('organization_members')
        .select('id, name, rank, phone, source_customer_id, external_id')
        .ilike('phone', `%${q}%`)
        .limit(30),
    ]);

    const map = new Map<
      string,
      {
        id: string;
        name: string;
        rank: string | null;
        phone: string | null;
        customer_id: string | null;
      }
    >();

    for (const m of [...(membersByNameRes.data ?? []), ...(membersByPhoneRes.data ?? [])] as any[]) {
      const phoneDigits = normalizePhoneDigits(String(m.phone ?? ''));
      // phone 검색어가 숫자라면 "동일"만 허용 (부분일치 X)
      if (digits && /^\d{4,}$/.test(digits)) {
        if (phoneDigits && phoneDigits !== digits) continue;
      }

      map.set(String(m.id), {
        id: String(m.id),
        name: String(m.name ?? ''),
        rank: m.rank ? String(m.rank) : null,
        phone: m.phone ? String(m.phone) : null,
        customer_id: memberToCustomerId({
          source_customer_id: (m.source_customer_id ?? null) as string | null,
          external_id: (m.external_id ?? null) as string | null,
        }),
      });
    }

    const rows = [...map.values()].slice(0, 20);
    return NextResponse.json({ success: true, data: rows });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

