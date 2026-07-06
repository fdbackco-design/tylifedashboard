'use client';

import { useEffect, useState } from 'react';
import OrgTree from '@/components/org-tree/OrgTree';
import type { OrgTreeNode } from '@/lib/types';
import type { ContractItem } from '@/components/org-tree/OrgTreeNode';

type OrgNodeMetrics = {
  cumulativeUnitCount: number;
  monthlyUnitCount: number;
  recognizedCommissionWon: number;
  paidCommissionWon: number;
};

type Props = {
  yearMonth: string;
  roots: OrgTreeNode[];
  contractsByMember: Record<string, ContractItem[]>;
  goalUnitsByMemberId: Record<string, number>;
  showGoalUnitsLine?: boolean;
  showGoalProgressBar?: boolean;
  showCommissionMetrics?: boolean;
};

export default function AdminOrgTreeWithMetrics({
  yearMonth,
  roots,
  contractsByMember,
  goalUnitsByMemberId,
  showGoalUnitsLine = true,
  showGoalProgressBar = true,
  showCommissionMetrics = false,
}: Props) {
  const [metricsById, setMetricsById] = useState<Record<string, OrgNodeMetrics> | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMetricsById(null);
    setMetricsError(null);

    const load = async () => {
      try {
        const res = await fetch(
          `/api/admin/organization/metrics?year_month=${encodeURIComponent(yearMonth)}`,
          { credentials: 'include' },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as { metricsById: Record<string, OrgNodeMetrics> };
        if (!cancelled) setMetricsById(data.metricsById ?? {});
      } catch (e) {
        if (!cancelled) {
          setMetricsError(e instanceof Error ? e.message : '지표를 불러오지 못했습니다.');
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [yearMonth]);

  return (
    <div className="relative">
      {metricsById === null && !metricsError && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-orange-100 bg-orange-50/60 px-3 py-2 text-[11px] text-orange-900/90 sm:text-xs">
          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-orange-300 border-t-orange-700" />
          구좌·수당 지표를 계산하고 있습니다…
        </div>
      )}
      {metricsError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-800 sm:text-xs">
          지표 로드 실패: {metricsError}
        </div>
      )}
      <OrgTree
        roots={roots}
        contractsByMember={contractsByMember}
        metricsById={metricsById ?? undefined}
        goalUnitsByMemberId={goalUnitsByMemberId}
        showGoalUnitsLine={showGoalUnitsLine}
        showGoalProgressBar={showGoalProgressBar}
        showCommissionMetrics={showCommissionMetrics}
      />
    </div>
  );
}
