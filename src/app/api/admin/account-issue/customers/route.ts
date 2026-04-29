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
    const [nameRes, phoneRes] = await Promise.all([
      db.from('customers').select('id, name, phone').ilike('name', `%${q}%`).limit(15),
      db.from('customers').select('id, name, phone').ilike('phone', `%${q}%`).limit(15),
    ]);

    const rowsMap = new Map<string, { id: string; name: string; phone: string }>();
    for (const r of (nameRes.data ?? []) as Array<{ id: string; name: string; phone: string }>) rowsMap.set(r.id, r);
    for (const r of (phoneRes.data ?? []) as Array<{ id: string; name: string; phone: string }>) rowsMap.set(r.id, r);
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

