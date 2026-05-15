import { isContractJoinCompleted } from '@/lib/utils/contract-display-status';
import { getSettlementWindowForYearMonth } from '@/lib/settlement/settlement-window';
import type { OrgTreeRow } from '@/lib/types';
import type { RankType } from '@/lib/types/organization';
import { buildSettlementTreeRows } from '@/lib/settlement/settlement-org-tree';
import {
  formatDashboardParentLabel,
  stripCustomerMemberNamePrefix,
} from '@/lib/dashboard/display-format';

export type DashboardAggRow = {
  parent_name: string; // 누구 산하인지 (표시용)
  member_name: string;
  unit_sum: number;
  /** 집계에 포함된 계약 중 가장 늦은 가입일(YYYY-MM-DD); 없으면 null */
  latest_join_date: string | null;
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

/** 기준월 내 가입완료 계약을 `sales_member_id`(직접 영업) 기준으로 합산한 행 */
export type DashboardDirectPerfRow = {
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
  /** 기준월 정산 윈도우 + 가입 보류(해피콜 부재/계약취소 또는 렌탈신청번호 일치) */
  monthlyJoinDeferredSlots: DashboardAggResult;
  allTimeJoinedSlots: DashboardAggResult;
  /** 기준월 정산 윈도우 + 가입완료, 구좌는 계약의 sales_member_id(직접) 기준 */
  monthlyDirectJoinedBySalesMember: { total_units: number; rows: DashboardDirectPerfRow[] };
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
  happycall_result?: string | null;
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

/** 가입일(해당 집계 구간 내 최신 가입일) 내림차순, 동일 시 구좌 수 내림차순 */
function sortRowsByLatestJoinDateDesc(rows: DashboardAggRow[]): DashboardAggRow[] {
  return [...rows].sort((a, b) => {
    const ja = a.latest_join_date;
    const jb = b.latest_join_date;
    if (ja && jb) {
      if (jb !== ja) return jb.localeCompare(ja);
    } else if (jb && !ja) return 1;
    else if (ja && !jb) return -1;
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

/** 기준월 내 집계 시: 해피콜 결과 또는 렌탈신청번호가 가입 보류로 분류되는지 */
function isJoinDeferredContract(c: ContractRow): boolean {
  const hc = (c.happycall_result ?? '').trim();
  if (hc === '부재' || hc === '계약취소') return true;
  const rental = (c.rental_request_no ?? '').trim();
  if (rental === '렌탈기준 미충족' || rental === '가입건 없음') return true;
  return false;
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
  parentIdByMemberId: Map<string, string | null>,
  hqMemberId: string | null,
  sort: 'units_desc' | 'latest_join_desc',
): DashboardAggResult {
  const unitByMember = new Map<string, number>();
  const latestJoinByMember = new Map<string, string>();
  for (const c of contracts) {
    const mid = c.__attributed_member_id;
    if (!mid) continue;
    const unit = Number(c.unit_count ?? 0) || 0;
    unitByMember.set(mid, (unitByMember.get(mid) ?? 0) + unit);
    const jd = c.join_date;
    if (jd) {
      const prev = latestJoinByMember.get(mid);
      if (!prev || jd > prev) latestJoinByMember.set(mid, jd);
    }
  }

  const rows: DashboardAggRow[] = [];
  let total_units = 0;
  for (const [mid, unit_sum] of unitByMember.entries()) {
    total_units += unit_sum;
    const rawParent = parentNameById.get(mid) ?? '-';
    const pid = parentIdByMemberId.get(mid) ?? null;
    const rawName = memberNameById.get(mid);
    rows.push({
      parent_name: formatDashboardParentLabel(mid, pid, rawParent, hqMemberId),
      member_name:
        rawName !== undefined && rawName !== null
          ? stripCustomerMemberNamePrefix(rawName) || '(알수없음)'
          : '(알수없음)',
      unit_sum,
      latest_join_date: latestJoinByMember.get(mid) ?? null,
    });
  }
  const sorted =
    sort === 'latest_join_desc' ? sortRowsByLatestJoinDateDesc(rows) : sortRows(rows);
  return { total_units, rows: sorted };
}

function formatBriefingLines(rows: DashboardAggRow[], limit: number = 20): string {
  const head = rows.slice(0, limit);
  return head
    .map((r) => `(${r.parent_name}) ${r.member_name} [${r.unit_sum}구좌]`)
    .join('\n');
}

function buildMonthlyDirectJoinedBySalesMember(
  monthlyJoined: Array<ContractRow & { __attributed_member_id: string | null }>,
  memberNameById: Map<string, string>,
): { total_units: number; rows: DashboardDirectPerfRow[] } {
  const unitBySalesId = new Map<string, number>();
  for (const c of monthlyJoined) {
    const sid = (c.sales_member_id ?? null) as string | null;
    if (!sid) continue;
    const unit = Number(c.unit_count ?? 0) || 0;
    if (unit <= 0) continue;
    unitBySalesId.set(sid, (unitBySalesId.get(sid) ?? 0) + unit);
  }
  let total_units = 0;
  const rows: DashboardDirectPerfRow[] = [];
  for (const [memberId, unit_sum] of unitBySalesId.entries()) {
    total_units += unit_sum;
    const rawName = memberNameById.get(memberId);
    rows.push({
      member_name:
        rawName !== undefined && rawName !== null
          ? stripCustomerMemberNamePrefix(rawName) || '(알수없음)'
          : '(알수없음)',
      unit_sum,
    });
  }
  rows.sort((a, b) => {
    if (b.unit_sum !== a.unit_sum) return b.unit_sum - a.unit_sum;
    return a.member_name.localeCompare(b.member_name, 'ko');
  });
  return { total_units, rows };
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
        'id, join_date, unit_count, status, is_cancelled, sales_member_id, customer_id, sales_link_status, rental_request_no, invoice_no, memo, happycall_result',
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

  const hqMemberId =
    membersRaw.find((m) => m.name === '안성준')?.id ??
    membersRaw.find((m) => m.rank === '본사')?.id ??
    null;

  const parentIdByMemberId = new Map<string, string | null>();
  for (const r of treeRows) parentIdByMemberId.set(r.id, r.parent_id ?? null);

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

  const monthlyJoinDeferred = monthlyAll.filter(isJoinDeferredContract);

  const allTimeJoined = attributedContracts.filter((c) =>
    isContractJoinCompleted({
      status: c.status,
      rental_request_no: c.rental_request_no ?? null,
      invoice_no: c.invoice_no ?? null,
      memo: c.memo ?? null,
    }),
  );

  const monthlyTotalSlots = aggregateByMember(
    monthlyAll,
    memberNameById,
    parentNameById,
    parentIdByMemberId,
    hqMemberId,
    'units_desc',
  );
  const dailyTotalSlots = aggregateByMember(
    dailyAll,
    memberNameById,
    parentNameById,
    parentIdByMemberId,
    hqMemberId,
    'units_desc',
  );
  const monthlyJoinedSlots = aggregateByMember(
    monthlyJoined,
    memberNameById,
    parentNameById,
    parentIdByMemberId,
    hqMemberId,
    'units_desc',
  );
  const monthlyJoinDeferredSlots = aggregateByMember(
    monthlyJoinDeferred,
    memberNameById,
    parentNameById,
    parentIdByMemberId,
    hqMemberId,
    'units_desc',
  );
  const allTimeJoinedSlots = aggregateByMember(
    allTimeJoined,
    memberNameById,
    parentNameById,
    parentIdByMemberId,
    hqMemberId,
    'latest_join_desc',
  );

  const monthlyDirectJoinedBySalesMember = buildMonthlyDirectJoinedBySalesMember(
    monthlyJoined,
    memberNameById,
  );

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
    monthlyJoinDeferredSlots,
    allTimeJoinedSlots,
    monthlyDirectJoinedBySalesMember,
    dailyPerformanceByMember,
  };
}

