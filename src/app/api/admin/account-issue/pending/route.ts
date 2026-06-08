import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { normalizeName, normalizePhone } from '@/lib/account-issue/normalize';

/**
 * 사전 발급 계정 중 PENDING / MANUAL_REVIEW 상태인 항목을 후보 사람과 함께 반환한다.
 *
 * 관리자는 이 응답을 보고 후보 중 하나를 수동 매핑하거나, 매핑을 해제할 수 있다.
 */

type CandidatePerson = {
  member_id: string;
  name: string | null;
  rank: string | null;
  phone: string | null;
  category: 'CUSTOMER' | 'MANAGER';
  already_mapped_user_profile_id: string | null;
};

type RowOut = {
  user_profile_id: string;
  login_code: string | null;
  display_name: string | null;
  pre_issued_name: string | null;
  pre_issued_phone: string | null;
  mapping_status: 'PENDING' | 'MANUAL_REVIEW';
  mapping_reason: string | null;
  created_at: string | null;
  candidates: CandidatePerson[];
};

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const db = createAdminSupabaseClient();

  try {
    const { data: pendingRows, error: pErr } = await db
      .from('user_profiles')
      .select(
        'id, login_code, display_name, pre_issued_name, pre_issued_phone, mapping_status, mapping_reason, created_at, phone',
      )
      .in('mapping_status', ['PENDING', 'MANUAL_REVIEW'])
      .eq('role', 'member')
      .order('created_at', { ascending: false })
      .limit(200);
    if (pErr) throw new Error(pErr.message);

    const pending = (pendingRows ?? []) as any[];
    if (pending.length === 0) {
      return NextResponse.json({ success: true, data: [] as RowOut[] });
    }

    // 후보를 만들기 위한 사람 데이터 / 매핑 현황 일괄 로드
    const [membersRes, mappedRes] = await Promise.all([
      db
        .from('organization_members')
        .select('id, name, rank, phone, source_customer_id, external_id, is_active')
        .eq('is_active', true),
      db
        .from('user_profiles')
        .select('id, member_id')
        .not('member_id', 'is', null),
    ]);

    if (membersRes.error) throw new Error(`organization_members 조회 실패: ${membersRes.error.message}`);
    if (mappedRes.error) throw new Error(`기존 매핑 조회 실패: ${mappedRes.error.message}`);

    const mappedUserIdByMemberId = new Map<string, string>();
    for (const r of (mappedRes.data ?? []) as any[]) {
      const mid = (r.member_id ?? null) as string | null;
      if (mid) mappedUserIdByMemberId.set(mid, r.id as string);
    }

    type MemberRow = {
      id: string;
      name: string | null;
      rank: string | null;
      phone: string | null;
      source_customer_id: string | null;
      external_id: string | null;
    };

    const isCustomerVirtual = (m: MemberRow): boolean => {
      if (m.source_customer_id) return true;
      if (m.external_id && m.external_id.startsWith('customer:')) return true;
      return false;
    };

    const allMembers = ((membersRes.data ?? []) as any[]) as MemberRow[];

    // 이름 키로 사전 인덱싱
    const byName = new Map<string, MemberRow[]>();
    for (const m of allMembers) {
      const key = normalizeName(m.name ?? '');
      if (!key) continue;
      if (m.rank === '본사') continue;
      const arr = byName.get(key) ?? [];
      arr.push(m);
      byName.set(key, arr);
    }

    const out: RowOut[] = pending.map((p) => {
      const nameKey = normalizeName(p.pre_issued_name ?? p.display_name ?? '');
      const cands: CandidatePerson[] = [];
      if (nameKey) {
        for (const m of byName.get(nameKey) ?? []) {
          cands.push({
            member_id: m.id,
            name: m.name,
            rank: m.rank,
            phone: m.phone,
            category: isCustomerVirtual(m) ? 'CUSTOMER' : 'MANAGER',
            already_mapped_user_profile_id: mappedUserIdByMemberId.get(m.id) ?? null,
          });
        }
        // CUSTOMER 가 위로 오게 정렬, 같은 카테고리는 phone 일치 우선
        const phoneDigits = normalizePhone(p.pre_issued_phone ?? '');
        cands.sort((a, b) => {
          const ac = a.category === 'CUSTOMER' ? 0 : 1;
          const bc = b.category === 'CUSTOMER' ? 0 : 1;
          if (ac !== bc) return ac - bc;
          const ap = normalizePhone(a.phone ?? '') === phoneDigits ? 0 : 1;
          const bp = normalizePhone(b.phone ?? '') === phoneDigits ? 0 : 1;
          return ap - bp;
        });
      }
      return {
        user_profile_id: p.id,
        login_code: p.login_code ?? null,
        display_name: p.display_name ?? null,
        pre_issued_name: p.pre_issued_name ?? null,
        pre_issued_phone: p.pre_issued_phone ?? null,
        mapping_status: p.mapping_status,
        mapping_reason: p.mapping_reason ?? null,
        created_at: p.created_at ?? null,
        candidates: cands,
      };
    });

    return NextResponse.json({ success: true, data: out });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
