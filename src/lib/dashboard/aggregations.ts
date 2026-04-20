import { isContractJoinCompleted } from '@/lib/utils/contract-display-status';
import { getSettlementWindowForYearMonth } from '@/lib/settlement/settlement-window';
import type { OrgTreeRow } from '@/lib/types';
import type { RankType } from '@/lib/types/organization';
import { buildSettlementTreeRows } from '@/lib/settlement/settlement-org-tree';

export type DashboardAggRow = {
  parent_name: string; // 누구 산하인지 (표시용)
  member_name: string;
  unit_sum: number;
};

export type DashboardAggResult = {
  total_units: number;
  rows: DashboardAggRow[];
};

export type DailyPerformanceRow = {
  parent_name: string;
  member_name: string;
  unit_sum: number;
};

export type DashboardAggregations = {
  year_month: string;
  month_window: { start_date: string; end_date: string };
  briefing: {
    run_date_ymd: string; // 오늘(서울) YYYY-MM-DD
    base_date_ymd: string; // 전날(서울) YYYY-MM-DD
    text: string;
  };
  monthlyTotalSlots: DashboardAggResult;
  dailyTotalSlots: DashboardAggResult;
  monthlyJoinedSlots: DashboardAggResult;
  allTimeJoinedSlots: DashboardAggResult;
  dailyPerformanceByMember: { total_units: number; rows: DailyPerformanceRow[] };
};

type MemberRow = {
  id: string;
  name: string;
  rank: RankType;
  external_id?: string | null;
  source_customer_id?: string | null;
};

type ContractRow = {
  id: string;
  join_date: string | null;
  unit_count: number | null;
  status: string;
  is_cancelled: boolean;
  sales_member_id: string | null;
  customer_id?: string | null;
  sales_link_status?: string | null;
  rental_request_no?: string | null;
  invoice_no?: string | null;
  memo?: string | null;
};

function getSeoulYmd(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function addDaysYmd(ymd: string, deltaDays: number): string {
  // ymd: YYYY-MM-DD (서울 기준 date string)
  const [ys, ms, ds] = ymd.split('-');
  const y = parseInt(ys, 10);
  const m = parseInt(ms, 10);
  const d = parseInt(ds, 10);
  // Date.UTC 사용 (timezone 영향 최소화). 결과는 다시 YYYY-MM-DD로 포맷.
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function toKoreanDateTitle(ymd: string): string {
  const [ys, ms, ds] = ymd.split('-');
  return `${parseInt(ys, 10)}년 ${parseInt(ms, 10)}월 ${parseInt(ds, 10)}일`;
}

function sortRows(rows: DashboardAggRow[]): DashboardAggRow[] {
  return [...rows].sort((a, b) => {
    if (b.unit_sum !== a.unit_sum) return b.unit_sum - a.unit_sum;
    return a.member_name.localeCompare(b.member_name, 'ko');
  });
}

function buildMemberIdByCustomerId(members: MemberRow[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const row of members as any[]) {
    const sid = (row.source_customer_id ?? null) as string | null;
    if (sid && row.rank !== '본사') {
      if (!m.has(sid)) m.set(sid, row.id);
      continue;
    }
    const ext = (row.external_id ?? null) as string | null;
    if (ext && ext.startsWith('customer:') && row.rank !== '본사') {
      const customerId = ext.slice('customer:'.length);
      if (!m.has(customerId)) m.set(customerId, row.id);
    }
  }
  return m;
}

function attributeSalesMemberId(
  c: ContractRow,
  memberIdByCustomerId: Map<string, string>,
): string | null {
  // 정책: customer_id가 organization_members(고객 노드/가상 노드 포함)로 매핑되면 그 노드로 귀속.
  const cid = (c.customer_id ?? null) as string | null;
  if (cid) {
    const mapped = memberIdByCustomerId.get(cid) ?? null;
    if (mapped) return mapped;
  }
  return (c.sales_member_id ?? null) as string | null;
}

function buildParentNameByMemberId(treeRows: OrgTreeRow[]): Map<string, string> {
  const nameById = new Map<string, string>();
  for (const r of treeRows) nameById.set(r.id, r.name);
  const parentNameById = new Map<string, string>();
  for (const r of treeRows) {
    if (!r.parent_id) {
      parentNameById.set(r.id, '-');
      continue;
    }
    parentNameById.set(r.id, nameById.get(r.parent_id) ?? '-');
  }
  return parentNameById;
}

function aggregateByMember(
  contracts: Array<ContractRow & { __attributed_member_id: string | null }>,
  memberNameById: Map<string, string>,
  parentNameById: Map<string, string>,
): DashboardAggResult {
  const unitByMember = new Map<string, number>();
  for (const c of contracts) {
    const mid = c.__attributed_member_id;
    if (!mid) continue;
    const unit = Number(c.unit_count ?? 0) || 0;
    unitByMember.set(mid, (unitByMember.get(mid) ?? 0) + unit);
  }

  const rows: DashboardAggRow[] = [];
  let total_units = 0;
  for (const [mid, unit_sum] of unitByMember.entries()) {
    total_units += unit_sum;
    rows.push({
      parent_name: parentNameById.get(mid) ?? '-',
      member_name: memberNameById.get(mid) ?? '(알수없음)',
      unit_sum,
    });
  }
  return { total_units, rows: sortRows(rows) };
}

function formatBriefingLines(rows: DashboardAggRow[], limit: number = 20): string {
  const head = rows.slice(0, limit);
  return head
    .map((r) => `(${r.parent_name}) ${r.member_name} [${r.unit_sum}구좌]`)
    .join('\n');
}

export async function buildDashboardAggregations(opts: {
  db: {
    from: (table: string) => any;
  };
  year_month: string; // 예: '2026-04'
  now?: Date;
}): Promise<DashboardAggregations> {
  const { db, year_month } = opts;
  const now = opts.now ?? new Date();

  const run_date_ymd = getSeoulYmd(now);
  const base_date_ymd = addDaysYmd(run_date_ymd, -1);

  const month_window = getSettlementWindowForYearMonth(year_month);

  const [membersRes, edgesRes, contractsRes] = await Promise.all([
    db
      .from('organization_members')
      .select('id, name, rank, external_id, source_customer_id')
      .eq('is_active', true),
    db.from('organization_edges').select('parent_id, child_id'),
    db
      .from('contracts')
      .select(
        'id, join_date, unit_count, status, is_cancelled, sales_member_id, customer_id, sales_link_status, rental_request_no, invoice_no, memo',
      ),
  ]);

  if (membersRes.error) throw new Error(`조직원 조회 실패: ${membersRes.error.message}`);
  if (edgesRes.error) throw new Error(`조직 엣지 조회 실패: ${edgesRes.error.message}`);
  if (contractsRes.error) throw new Error(`계약 조회 실패: ${contractsRes.error.message}`);

  const membersRaw = (membersRes.data ?? []) as MemberRow[];
  const edgesRaw = (edgesRes.data ?? []) as Array<{ parent_id: string | null; child_id: string }>;
  const contractsRaw = (contractsRes.data ?? []) as ContractRow[];

  const treeRows = buildSettlementTreeRows(
    membersRaw.map((m) => ({
      id: m.id,
      name: m.name,
      rank: m.name === '안성준' ? ('본사' as const) : m.rank,
      source_customer_id: m.source_customer_id ?? null,
    })),
    edgesRaw,
  );

  const memberNameById = new Map<string, string>();
  for (const m of membersRaw) memberNameById.set(m.id, m.name);
  const parentNameById = buildParentNameByMemberId(treeRows);
  const memberIdByCustomerId = buildMemberIdByCustomerId(membersRaw);

  const attributedContracts = contractsRaw.map((c) => ({
      ...c,
      join_date: (c.join_date ?? null) ? String(c.join_date).slice(0, 10) : null,
      __attributed_member_id: attributeSalesMemberId(c, memberIdByCustomerId),
      unit_count: Number(c.unit_count ?? 0) || 0,
    }));

  const inMonthWindow = (c: { join_date: string | null }) => {
    if (!c.join_date) return false;
    return c.join_date >= month_window.start_date && c.join_date <= month_window.end_date;
  };
  const onBaseDate = (c: { join_date: string | null }) => c.join_date === base_date_ymd;

  const monthlyAll = attributedContracts.filter(inMonthWindow);
  const dailyAll = attributedContracts.filter(onBaseDate);

  const monthlyJoined = monthlyAll.filter((c) =>
    isContractJoinCompleted({
      status: c.status,
      rental_request_no: c.rental_request_no ?? null,
      invoice_no: c.invoice_no ?? null,
      memo: c.memo ?? null,
    }),
  );

  const allTimeJoined = attributedContracts.filter((c) =>
    isContractJoinCompleted({
      status: c.status,
      rental_request_no: c.rental_request_no ?? null,
      invoice_no: c.invoice_no ?? null,
      memo: c.memo ?? null,
    }),
  );

  const monthlyTotalSlots = aggregateByMember(monthlyAll, memberNameById, parentNameById);
  const dailyTotalSlots = aggregateByMember(dailyAll, memberNameById, parentNameById);
  const monthlyJoinedSlots = aggregateByMember(monthlyJoined, memberNameById, parentNameById);
  const allTimeJoinedSlots = aggregateByMember(allTimeJoined, memberNameById, parentNameById);

  // 담당자별 당일 영업 실적: dailyAll을 담당자별로 합산한 것(= dailyTotalSlots와 동일하지만, 카드/표 의미를 분리)
  const dailyPerformanceByMember = {
    total_units: dailyTotalSlots.total_units,
    rows: dailyTotalSlots.rows.map((r) => ({
      parent_name: r.parent_name,
      member_name: r.member_name,
      unit_sum: r.unit_sum,
    })),
  };

  const briefingTitle = `${toKoreanDateTitle(run_date_ymd)} 아침 브리핑`;
  const section1Title = `${toKoreanDateTitle(base_date_ymd)} TY 가입 현황`;

  const briefingText = [
    briefingTitle,
    '',
    section1Title,
    '',
    `1. 당일 가입자 [${dailyTotalSlots.total_units}구좌]`,
    dailyTotalSlots.rows.length ? formatBriefingLines(dailyTotalSlots.rows) : '(데이터 없음)',
    '',
    `2. ${year_month} 누적 가입 완료자 [${monthlyJoinedSlots.total_units}구좌]`,
    monthlyJoinedSlots.rows.length ? formatBriefingLines(monthlyJoinedSlots.rows) : '(데이터 없음)',
    '',
  ].join('\n');

  return {
    year_month,
    month_window: { start_date: month_window.start_date, end_date: month_window.end_date },
    briefing: { run_date_ymd, base_date_ymd, text: briefingText },
    monthlyTotalSlots,
    dailyTotalSlots,
    monthlyJoinedSlots,
    allTimeJoinedSlots,
    dailyPerformanceByMember,
  };
}

