import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { isAdminAuthed } from '@/lib/admin-auth';

function normalizePhoneDigits(v: string): string {
  return v.replace(/\D/g, '');
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAdminAuthed(req)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const q = req.nextUrl.searchParams.get('query')?.trim() ?? '';
  if (!q) return NextResponse.json({ success: true, data: [] as any[] });

  const digits = normalizePhoneDigits(q);
  const isDigits = digits.length >= 4 && digits !== q;

  const db = createAdminSupabaseClient();

  try {
    // 1) 기존: customers 테이블에서 직접 검색
    const [nameRes, phoneRes] = await Promise.all([
      db.from('customers').select('id, name, phone').ilike('name', `%${q}%`).limit(15),
      db.from('customers').select('id, name, phone').ilike('phone', `%${q}%`).limit(15),
    ]);

    const rowsMap = new Map<string, { id: string; name: string; phone: string | null }>();
    for (const r of (nameRes.data ?? []) as Array<{ id: string; name: string; phone: string | null }>) rowsMap.set(r.id, r);
    for (const r of (phoneRes.data ?? []) as Array<{ id: string; name: string; phone: string | null }>) rowsMap.set(r.id, r);

    // 2) 보완: organization_members에서 name 포함/phone 동일 매칭 후, 그에 연결된 customers를 추가
    // - 어떤 케이스에서는 customers에 해당 인원이 없거나 검색 매칭이 안 되어 누락될 수 있음
    const [membersByNameRes, membersByPhoneRes] = await Promise.all([
      db
        .from('organization_members')
        .select('id, name, phone, source_customer_id, external_id')
        .ilike('name', `%${q}%`)
        .limit(50),
      // phone은 포맷이 섞일 수 있어, DB에서 1차로 ilike 매칭한 뒤 숫자만 비교로 확정한다.
      db
        .from('organization_members')
        .select('id, name, phone, source_customer_id, external_id')
        .ilike('phone', `%${q}%`)
        .limit(50),
    ]);

    const matchedMembers = [...(membersByNameRes.data ?? []), ...(membersByPhoneRes.data ?? [])] as Array<{
      id: string;
      name: string;
      phone: string | null;
      source_customer_id: string | null;
      external_id: string | null;
    }>;

    const memberToCustomerId = (m: {
      source_customer_id: string | null;
      external_id: string | null;
    }): string | null => {
      if (m.source_customer_id) return m.source_customer_id;
      const ext = m.external_id ?? '';
      if (ext.startsWith('customer:')) return ext.slice('customer:'.length) || null;
      return null;
    };

    const desiredCustomerIds = new Set<string>();
    for (const m of matchedMembers) {
      // phone 동일은 “숫자만”으로 비교(요청사항의 phone 동일 의미에 맞춤)
      if (digits.length >= 4) {
        const mp = normalizePhoneDigits(m.phone ?? '');
        if (mp && mp !== digits) continue;
      }

      const cid = memberToCustomerId(m);
      if (cid) desiredCustomerIds.add(cid);
    }

    if (desiredCustomerIds.size > 0) {
      const customerIds = [...desiredCustomerIds.values()].slice(0, 50);
      const { data: missingCustomers } = await db
        .from('customers')
        .select('id, name, phone')
        .in('id', customerIds);

      for (const c of (missingCustomers ?? []) as Array<{ id: string; name: string; phone: string | null }>) {
        rowsMap.set(c.id, c);
      }
    }

    const rows = [...rowsMap.values()];
    const filtered = isDigits
      ? rows.filter((r) => {
          const pd = normalizePhoneDigits(r.phone ?? '');
          return pd.includes(digits);
        })
      : rows;

    return NextResponse.json({ success: true, data: filtered });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

