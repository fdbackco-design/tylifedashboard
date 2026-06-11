'use client';

/**
 * 관리자 페이지 — 영업자별 월 목표 구좌 / 달성률 조직도
 *
 * - 기존 OrgTree 컴포넌트는 절대 건드리지 않고, 자체 미니 트리로 렌더한다.
 * - 데이터 출처:
 *   1) 페이지에서 props 로 받은 treeRows + orgMetricsById (정산/집계 계산 결과 그대로 이용)
 *   2) /api/admin/monthly-targets 에서 monthly_target_units 만 별도 조회
 * - 달성률 = monthlyUnitCount / target * 100. NULL target 은 20 으로 폴백.
 */

import { useEffect, useMemo, useState } from 'react';

type TreeRow = {
  id: string;
  name: string;
  rank: string;
  parent_id: string | null;
};

type NodeMetrics = {
  cumulativeUnitCount: number;
  monthlyUnitCount: number;
};

type TargetRow = { id: string; monthly_target_units: number | null };

type Props = {
  treeRows: TreeRow[];
  /** id -> { cumulativeUnitCount, monthlyUnitCount } */
  metricsById: Record<string, NodeMetrics>;
  /** 본사 노드(들)는 트리 최상위에서 숨길 수 있도록 옵션 제공 */
  hideHqRoot?: boolean;
};

type Node = TreeRow & {
  children: Node[];
  depth: number;
  /** 자기 자신 monthlyUnitCount */
  monthlyUnitCount: number;
  cumulativeUnitCount: number;
  /** 산하(자기 제외) monthlyUnitCount 합 */
  subordinateMonthlyUnits: number;
};

const DEFAULT_TARGET = 20;

function buildTree(rows: TreeRow[]): Node[] {
  const byId = new Map<string, Node>();
  for (const r of rows) {
    byId.set(r.id, { ...r, children: [], depth: 0, monthlyUnitCount: 0, cumulativeUnitCount: 0, subordinateMonthlyUnits: 0 });
  }
  const roots: Node[] = [];
  for (const r of rows) {
    const node = byId.get(r.id)!;
    if (r.parent_id && byId.has(r.parent_id)) {
      const parent = byId.get(r.parent_id)!;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  // depth 설정
  const setDepth = (n: Node, d: number) => {
    n.depth = d;
    for (const c of n.children) setDepth(c, d + 1);
  };
  for (const r of roots) setDepth(r, 0);
  return roots;
}

function applyMetrics(roots: Node[], metricsById: Record<string, NodeMetrics>): void {
  const stack: Node[] = [...roots];
  while (stack.length) {
    const n = stack.pop()!;
    const m = metricsById[n.id];
    if (m) {
      n.monthlyUnitCount = m.monthlyUnitCount ?? 0;
      n.cumulativeUnitCount = m.cumulativeUnitCount ?? 0;
    }
    for (const c of n.children) stack.push(c);
  }

  // 산하 monthlyUnits 합산 (자기 제외)
  const recurse = (n: Node): number => {
    let subSum = 0;
    for (const c of n.children) {
      subSum += c.monthlyUnitCount + recurse(c);
    }
    n.subordinateMonthlyUnits = subSum;
    return subSum;
  };
  for (const r of roots) recurse(r);
}

function pctColor(pct: number): string {
  if (pct >= 100) return 'text-emerald-600';
  if (pct >= 70) return 'text-orange-600';
  if (pct >= 30) return 'text-amber-600';
  return 'text-slate-500';
}

function NodeRow({
  node,
  targetById,
}: {
  node: Node;
  targetById: Map<string, number | null>;
}) {
  const rawTarget = targetById.get(node.id) ?? null;
  const target = rawTarget ?? DEFAULT_TARGET;
  const isDefault = rawTarget == null;
  const monthly = node.monthlyUnitCount;
  const pct = target > 0 ? Math.round((monthly / target) * 100) : 0;
  const isHq = node.rank === '본사';

  return (
    <>
      <li className="border-b border-slate-100 py-1.5">
        <div
          className="grid items-center gap-2 text-xs sm:text-sm"
          style={{
            gridTemplateColumns: 'minmax(11rem,1.6fr) 4rem 4rem 4rem 5rem 1fr',
          }}
        >
          <div
            className="min-w-0 truncate"
            style={{ paddingLeft: `${node.depth * 0.9}rem` }}
            title={`${node.name} (${node.rank})`}
          >
            <span className="text-slate-400">{node.depth > 0 ? '└ ' : ''}</span>
            <span className="font-medium text-slate-900">{node.name}</span>
            <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
              {node.rank}
            </span>
          </div>
          <div className="tabular-nums text-right text-slate-700" title="현재 누적 구좌">
            {node.cumulativeUnitCount.toLocaleString('ko-KR')}
          </div>
          <div className="tabular-nums text-right text-slate-700" title="이번 달 가입 구좌">
            {monthly.toLocaleString('ko-KR')}
          </div>
          <div className="tabular-nums text-right text-slate-700" title="산하(이번 달) 구좌">
            {node.subordinateMonthlyUnits.toLocaleString('ko-KR')}
          </div>
          <div className="tabular-nums text-right text-slate-900">
            {target.toLocaleString('ko-KR')}
            {isDefault && (
              <span className="ml-0.5 text-[10px] text-slate-400" title="기본값(미설정)">
                *
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full ${
                  pct >= 100 ? 'bg-emerald-500' : 'bg-orange-500'
                }`}
                style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
              />
            </div>
            <span className={`shrink-0 text-right text-xs tabular-nums ${pctColor(pct)}`}>
              {pct}%
            </span>
          </div>
        </div>
        {isHq && (
          <p className="ml-2 mt-0.5 text-[10px] text-slate-400">
            본사 노드는 목표 달성률 의미가 없을 수 있습니다.
          </p>
        )}
      </li>
      {node.children.length > 0 && (
        <ul className="m-0 list-none p-0">
          {node.children.map((c) => (
            <NodeRow key={c.id} node={c} targetById={targetById} />
          ))}
        </ul>
      )}
    </>
  );
}

export default function MonthlyTargetsTreeSection(props: Props) {
  const { treeRows, metricsById, hideHqRoot = false } = props;

  const [targets, setTargets] = useState<TargetRow[] | null>(null);
  const [loadError, setLoadError] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/monthly-targets', { credentials: 'include' });
        const json = await res.json();
        if (!res.ok) {
          if (!cancelled) setLoadError(json?.error ?? '목표 조회 실패');
          return;
        }
        if (!cancelled) setTargets((json?.targets ?? []) as TargetRow[]);
      } catch (e) {
        if (!cancelled) setLoadError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const targetById = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const t of targets ?? []) m.set(t.id, t.monthly_target_units);
    return m;
  }, [targets]);

  const tree = useMemo(() => {
    const filtered = hideHqRoot ? treeRows.filter((r) => r.rank !== '본사') : treeRows;
    // hideHqRoot 인 경우 본사 노드 제거 후 부모 끊긴 노드는 루트로 승격
    const filteredSet = new Set(filtered.map((r) => r.id));
    const adjusted: TreeRow[] = filtered.map((r) => ({
      ...r,
      parent_id: r.parent_id && filteredSet.has(r.parent_id) ? r.parent_id : null,
    }));
    const roots = buildTree(adjusted);
    applyMetrics(roots, metricsById);
    // 정렬: 가입 구좌 많은 순 (안정성 위해 이름 보조키)
    const sortDeep = (nodes: Node[]) => {
      nodes.sort((a, b) => {
        if (b.monthlyUnitCount !== a.monthlyUnitCount) return b.monthlyUnitCount - a.monthlyUnitCount;
        return a.name.localeCompare(b.name);
      });
      for (const n of nodes) sortDeep(n.children);
    };
    sortDeep(roots);
    return roots;
  }, [treeRows, metricsById, hideHqRoot]);

  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-3 shadow-sm ring-1 ring-slate-900/[0.035] sm:p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">영업자별 월 목표 구좌</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">
            각 영업자가 본인 화면(/organization)에서 설정한 목표를 조직도 형태로 확인합니다. <code>*</code>{' '}
            표시는 기본값({DEFAULT_TARGET}) 사용 중인 멤버입니다.
          </p>
        </div>
        {loadError && <span className="text-xs text-red-600">{loadError}</span>}
      </header>

      <div
        className="grid items-center gap-2 border-b border-slate-200 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500"
        style={{ gridTemplateColumns: 'minmax(11rem,1.6fr) 4rem 4rem 4rem 5rem 1fr' }}
      >
        <div>이름 / 직급</div>
        <div className="text-right">누적</div>
        <div className="text-right">이번달</div>
        <div className="text-right">산하</div>
        <div className="text-right">목표</div>
        <div>달성률</div>
      </div>

      <ul className="m-0 list-none p-0">
        {tree.map((n) => (
          <NodeRow key={n.id} node={n} targetById={targetById} />
        ))}
      </ul>

      {tree.length === 0 && (
        <p className="py-4 text-center text-xs text-slate-500">표시할 조직원이 없습니다.</p>
      )}
    </section>
  );
}
