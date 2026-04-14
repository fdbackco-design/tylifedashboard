import type { Metadata } from 'next';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { formatKRW } from '@/lib/settlement/calculator';

export const metadata: Metadata = { title: '대시보드' };

export const dynamic = 'force-dynamic';

async function getDashboardStats() {
  const db = createAdminSupabaseClient();
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [contractsRes, settlementsRes, syncRes] = await Promise.all([
    db
      .from('contracts')
      .select('status, is_cancelled, unit_count', { count: 'exact' }),
    db
      .from('monthly_settlements')
      .select('total_amount')
      .eq('year_month', yearMonth),
    db
      .from('sync_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(1)
      .single(),
  ]);

  const contracts = contractsRes.data ?? [];
  const totalContracts = contractsRes.count ?? 0;
  const activeContracts = contracts.filter(
    (c) => !c.is_cancelled && !['취소', '해약'].includes(c.status),
  ).length;
  const totalUnits = contracts.reduce(
    (sum, c) => sum + (c.is_cancelled ? 0 : (c.unit_count as number)),
    0,
  );

  const monthlyTotal = (settlementsRes.data ?? []).reduce(
    (sum, s) => sum + (s.total_amount as number),
    0,
  );

  return {
    totalContracts,
    activeContracts,
    totalUnits,
    monthlyTotal,
    yearMonth,
    lastSync: syncRes.data,
  };
}

export default async function DashboardPage() {
  const stats = await getDashboardStats();

  const cards = [
    { label: '전체 계약 수', value: `${stats.totalContracts.toLocaleString()}건` },
    { label: '활성 계약', value: `${stats.activeContracts.toLocaleString()}건` },
    { label: '총 구좌 수', value: `${stats.totalUnits.toLocaleString()}구좌` },
    {
      label: `${stats.yearMonth} 정산 합계`,
      value: formatKRW(stats.monthlyTotal),
    },
  ];

  return (
    <div className="p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-800">대시보드</h2>
        <p className="text-sm text-gray-500 mt-1">TY Life 계약 및 정산 현황</p>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map((card) => (
          <div
            key={card.label}
            className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm"
          >
            <p className="text-sm text-gray-500">{card.label}</p>
            <p className="text-2xl font-bold text-gray-800 mt-1">{card.value}</p>
          </div>
        ))}
      </div>

      {/* 최근 동기화 */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm max-w-lg">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">최근 동기화</h3>
        {stats.lastSync ? (
          <div className="text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-500">상태</span>
              <span
                className={
                  stats.lastSync.status === 'completed'
                    ? 'text-green-600 font-medium'
                    : stats.lastSync.status === 'failed'
                      ? 'text-red-600 font-medium'
                      : 'text-yellow-600 font-medium'
                }
              >
                {stats.lastSync.status}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">시작</span>
              <span className="text-gray-700">
                {new Date(stats.lastSync.started_at as string).toLocaleString('ko-KR', {
                  timeZone: 'Asia/Seoul',
                })}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">수집/생성/수정/오류</span>
              <span className="text-gray-700">
                {stats.lastSync.total_fetched} / {stats.lastSync.total_created} / {stats.lastSync.total_updated} / {stats.lastSync.total_errors}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-400">동기화 이력 없음</p>
        )}
      </div>
    </div>
  );
}
