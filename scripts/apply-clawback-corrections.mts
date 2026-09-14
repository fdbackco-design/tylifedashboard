import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { applyTeamVerifiedClawbackCorrections } from '@/lib/settlement/apply-clawback-corrections';
import { MEMBER_IDS } from '@/lib/settlement/confirmed-payout-seeds';

const envText = readFileSync('.env.local', 'utf8');
for (const line of envText.split(/\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  process.env[m[1]] = v;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('missing supabase env');

const db = createClient(url, key, { auth: { persistSession: false } });

for (const [name, id] of Object.entries(MEMBER_IDS)) {
  const { data } = await db.from('organization_members').select('id,name').eq('id', id).maybeSingle();
  console.log(name, id, '=>', data?.name ?? 'MISSING');
}

const result = await applyTeamVerifiedClawbackCorrections(db);
console.log('RESULT', result);

const { data: jul } = await db
  .from('monthly_settlements')
  .select('total_amount,is_finalized,rollup_commission')
  .eq('year_month', '2026-07')
  .eq('member_id', MEMBER_IDS.임태순)
  .maybeSingle();
console.log('JULY 임태순', jul);

const { data: aug } = await db
  .from('settlement_statement_overrides')
  .select('member_id,clawback_amount')
  .eq('year_month', '2026-08')
  .not('clawback_amount', 'is', null);
for (const r of aug ?? []) {
  const { data: m } = await db
    .from('organization_members')
    .select('name')
    .eq('id', r.member_id)
    .maybeSingle();
  console.log('AUG clawback', m?.name, r.clawback_amount);
}
