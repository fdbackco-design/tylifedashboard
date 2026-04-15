/**
 * 조직도 “관계어 노드” 정리 스크립트.
 *
 * 목적:
 * - 계약자 편입 로직 버그로 생성된 관계어 노드(예: 자녀/가족/모/부/아내/자 등)를
 *   organization_edges에서 제거하고(트리에서 숨김),
 *   안전 조건을 만족하면 organization_members 자체도 삭제(옵션)합니다.
 *
 * 기본은 DRY-RUN (조회만). 실제 삭제는 --apply 필요.
 *
 * 사용:
 *   node scripts/cleanup-recruitment-nodes.mjs
 *   node scripts/cleanup-recruitment-nodes.mjs --apply
 *   node scripts/cleanup-recruitment-nodes.mjs --apply --delete-members
 *   node scripts/cleanup-recruitment-nodes.mjs --names 자녀,가족,모
 *
 * 필요 env:
 * - NEXT_PUBLIC_SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 */

import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

function parseArgs(argv) {
  const out = {
    apply: false,
    deleteMembers: false,
    names: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--delete-members') out.deleteMembers = true;
    else if (a === '--names') out.names = argv[i + 1] ?? '';
    if (a === '--names') i++;
  }
  return out;
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
];

const args = parseArgs(process.argv);
const bannedNames = (args.names ? args.names.split(',') : DEFAULT_BANNED)
  .map((s) => s.trim())
  .filter(Boolean);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  console.log(`bannedNames(${bannedNames.length}): ${bannedNames.join(', ')}`);
  console.log(`mode: ${args.apply ? 'APPLY' : 'DRY-RUN'}${args.deleteMembers ? ' + deleteMembers' : ''}`);

  const { data: members, error: mErr } = await db
    .from('organization_members')
    .select('id, name, rank, is_active, external_id')
    .in('name', bannedNames);

  if (mErr) throw new Error(`organization_members 조회 실패: ${mErr.message}`);

  const list = members ?? [];
  if (list.length === 0) {
    console.log('No matching organization_members found.');
    return;
  }

  console.log(`Found members: ${list.length}`);

  // 1) edge 제거 대상(=child)
  const ids = list.map((m) => m.id);
  const { data: edges, error: eErr } = await db
    .from('organization_edges')
    .select('id, parent_id, child_id')
    .in('child_id', ids);
  if (eErr) throw new Error(`organization_edges 조회 실패: ${eErr.message}`);

  console.log(`Edges where child is banned: ${(edges ?? []).length}`);
  for (const e of edges ?? []) {
    console.log(`- edge ${e.id}: parent=${e.parent_id ?? 'null'} child=${e.child_id}`);
  }

  if (args.apply && (edges ?? []).length > 0) {
    const edgeIds = (edges ?? []).map((e) => e.id);
    const { error: dErr } = await db.from('organization_edges').delete().in('id', edgeIds);
    if (dErr) throw new Error(`organization_edges 삭제 실패: ${dErr.message}`);
    console.log(`Deleted edges: ${edgeIds.length}`);
  }

  // 2) member 삭제(옵션) — 안전 조건
  // - sales_member_id로 사용 중이면 삭제 금지
  // - contractor_member_id로 사용 중이면 삭제 금지
  // - external_id가 있으면(실제 사원일 가능성) 기본은 삭제 금지
  if (!args.deleteMembers) {
    console.log('Skip deleting organization_members (use --delete-members to enable).');
    return;
  }

  const deletable = [];
  const skipped = [];

  for (const m of list) {
    if (m.external_id) {
      skipped.push({ id: m.id, name: m.name, reason: 'has external_id' });
      continue;
    }

    const [salesRef, contractorRef] = await Promise.all([
      db.from('contracts').select('id', { count: 'exact', head: true }).eq('sales_member_id', m.id),
      db.from('contracts').select('id', { count: 'exact', head: true }).eq('contractor_member_id', m.id),
    ]);

    const salesCnt = salesRef.count ?? 0;
    const contractorCnt = contractorRef.count ?? 0;
    if (salesRef.error || contractorRef.error) {
      skipped.push({ id: m.id, name: m.name, reason: 'refcount query failed' });
      continue;
    }

    if (salesCnt > 0 || contractorCnt > 0) {
      skipped.push({
        id: m.id,
        name: m.name,
        reason: `referenced by contracts (sales=${salesCnt}, contractor=${contractorCnt})`,
      });
      continue;
    }

    deletable.push(m);
  }

  console.log(`Deletable members: ${deletable.length}`);
  console.log(`Skipped members: ${skipped.length}`);
  for (const s of skipped) console.log(`- skip ${s.name} (${s.id}): ${s.reason}`);

  if (!args.apply) {
    console.log('DRY-RUN: not deleting members. Re-run with --apply to execute.');
    return;
  }

  if (deletable.length === 0) return;
  const delIds = deletable.map((m) => m.id);
  const { error: dmErr } = await db.from('organization_members').delete().in('id', delIds);
  if (dmErr) throw new Error(`organization_members 삭제 실패: ${dmErr.message}`);
  console.log(`Deleted members: ${delIds.length}`);
}

main().catch((e) => {
  console.error(e?.stack ?? String(e));
  process.exit(1);
});

