import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function isAuthorized(req: NextRequest): boolean {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;

  const token = authHeader.slice(7);
  const secret = process.env.SYNC_API_SECRET;
  if (!secret) return false;

  const encoder = new TextEncoder();
  const a = encoder.encode(token);
  const b = encoder.encode(secret);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const DEFAULT_BANNED = [
  '자녀',
  '가족',
  '모',
  '부',
  '아내',
  '자',
  // 안전 보강
  '남편',
  '배우자',
  '본인',
  '처',
  '아버지',
  '어머니',
] as const;

type CleanupRequest = {
  names?: string[];
  delete_members?: boolean;
  /** true면 참조 중인 계약들의 contractor 편입을 해제한 뒤 삭제를 시도 */
  unlink_contractor_contracts?: boolean;
};

async function getTargets(db: ReturnType<(typeof import('@/lib/supabase/server'))['createAdminSupabaseClient']>, names: string[]) {
  const { data: members, error: mErr } = await db
    .from('organization_members')
    .select('id, name, rank, is_active, external_id')
    .in('name', names);
  if (mErr) throw new Error(mErr.message);

  const list = (members ?? []) as Array<{
    id: string;
    name: string;
    rank: string;
    is_active: boolean;
    external_id: string | null;
  }>;

  const ids = list.map((m) => m.id);
  const { data: edges, error: eErr } = await db
    .from('organization_edges')
    .select('id, parent_id, child_id')
    .in('child_id', ids);
  if (eErr) throw new Error(eErr.message);

  return { members: list, edges: (edges ?? []) as Array<{ id: string; parent_id: string | null; child_id: string }> };
}

/**
 * GET (dry-run)
 * - Vercel prod only
 * - Authorization required
 * - query:
 *   - names=자녀,가족,...
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (process.env.VERCEL !== '1') {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const rawNames = (url.searchParams.get('names') ?? '').trim();
  const names =
    rawNames.length > 0
      ? rawNames.split(',').map((s) => s.trim()).filter(Boolean)
      : [...DEFAULT_BANNED];

  const { createAdminSupabaseClient } = await import('@/lib/supabase/server');
  const db = createAdminSupabaseClient();

  try {
    const { members, edges } = await getTargets(db, names);
    return NextResponse.json({
      success: true,
      dry_run: true,
      names,
      members_count: members.length,
      edges_count: edges.length,
      members,
      edges,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/**
 * POST (apply)
 * - Vercel prod only
 * - Authorization required
 * body:
 * - names?: string[]
 * - delete_members?: boolean (default false)
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (process.env.VERCEL !== '1') {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: CleanupRequest = {};
  try {
    body = (await req.json()) as CleanupRequest;
  } catch {
    // ignore
  }

  const names = (body.names?.length ? body.names : [...DEFAULT_BANNED]).map((s) => s.trim()).filter(Boolean);
  const deleteMembers = body.delete_members === true;
  const unlinkContractorContracts = body.unlink_contractor_contracts === true;

  const { createAdminSupabaseClient } = await import('@/lib/supabase/server');
  const db = createAdminSupabaseClient();

  try {
    const { members, edges } = await getTargets(db, names);

    // 1) edges 삭제
    const edgeIds = edges.map((e) => e.id);
    let deleted_edges = 0;
    if (edgeIds.length > 0) {
      const { error: dErr } = await db.from('organization_edges').delete().in('id', edgeIds);
      if (dErr) throw new Error(dErr.message);
      deleted_edges = edgeIds.length;
    }

    // 2) members 삭제(옵션, 안전 조건)
    const deleted_members: string[] = [];
    const skipped_members: Array<{ id: string; name: string; reason: string }> = [];
    const unlinked_contractor_contracts: Array<{ member_id: string; updated: number }> = [];

    if (deleteMembers && members.length > 0) {
      for (const m of members) {
        if (m.external_id) {
          skipped_members.push({ id: m.id, name: m.name, reason: 'has external_id' });
          continue;
        }

        const [salesRef, contractorRef] = await Promise.all([
          db.from('contracts').select('id', { count: 'exact', head: true }).eq('sales_member_id', m.id),
          db.from('contracts').select('id', { count: 'exact', head: true }).eq('contractor_member_id', m.id),
        ]);

        if (salesRef.error || contractorRef.error) {
          skipped_members.push({ id: m.id, name: m.name, reason: 'refcount query failed' });
          continue;
        }

        const salesCnt = salesRef.count ?? 0;
        const contractorCnt = contractorRef.count ?? 0;
        if (salesCnt > 0) {
          skipped_members.push({
            id: m.id,
            name: m.name,
            reason: `referenced by contracts as sales_member_id (sales=${salesCnt})`,
          });
          continue;
        }

        if (contractorCnt > 0 && unlinkContractorContracts) {
          const { error: uErr } = await db
            .from('contracts')
            .update({
              contractor_member_id: null,
              contractor_link_status: 'not_internal',
              contractor_candidates_json: null,
            })
            .eq('contractor_member_id', m.id);
          if (uErr) {
            skipped_members.push({ id: m.id, name: m.name, reason: `unlink failed: ${uErr.message}` });
            continue;
          }
          // update 응답에서 count를 못 받는 환경이 있어, 사전 refcount(contractorCnt)를 업데이트 수로 기록
          unlinked_contractor_contracts.push({ member_id: m.id, updated: contractorCnt });
        }

        // unlink 이후 다시 참조 카운트 체크
        const { count: contractorCnt2, error: contractorRef2Err } = await db
          .from('contracts')
          .select('id', { count: 'exact', head: true })
          .eq('contractor_member_id', m.id);
        if (contractorRef2Err) {
          skipped_members.push({ id: m.id, name: m.name, reason: 'refcount query failed(after unlink)' });
          continue;
        }
        if ((contractorCnt2 ?? 0) > 0) {
          skipped_members.push({
            id: m.id,
            name: m.name,
            reason: `still referenced by contracts as contractor_member_id (contractor=${contractorCnt2 ?? 0})`,
          });
          continue;
        }

        const { error: dmErr } = await db.from('organization_members').delete().eq('id', m.id);
        if (dmErr) {
          skipped_members.push({ id: m.id, name: m.name, reason: dmErr.message });
          continue;
        }
        deleted_members.push(m.id);
      }
    }

    return NextResponse.json({
      success: true,
      dry_run: false,
      names,
      deleted_edges,
      delete_members: deleteMembers,
      unlink_contractor_contracts: unlinkContractorContracts,
      deleted_members_count: deleted_members.length,
      skipped_members_count: skipped_members.length,
      skipped_members,
      unlinked_contractor_contracts,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

