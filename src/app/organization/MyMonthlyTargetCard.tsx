'use client';

/**
 * 본인 "이번 달 목표 구좌" 카드 컴포넌트.
 *
 * - 서버 페이지에서 초기 값을 props 로 받아 즉시 표시 (깜빡임 방지)
 * - [수정] 클릭 → 인라인 input 으로 전환 → [저장] 시 PATCH /api/me/monthly-target
 * - 양의 정수만 허용. 저장 후 router.refresh() 로 누적/달성률 갱신
 * - 다른 화면(누적/산하 구좌 등)에는 절대 영향 없음
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  initialTarget: number;
  /** 이번 달 누적 가입 구좌 — 달성률 계산용 */
  periodJoinUnits: number;
  /** PENDING 계정 등 본인 member_id 가 없는 경우 수정 비활성 */
  canEdit: boolean;
};

export default function MyMonthlyTargetCard({ initialTarget, periodJoinUnits, canEdit }: Props) {
  const router = useRouter();
  const [target, setTarget] = useState<number>(initialTarget);
  const [editing, setEditing] = useState<boolean>(false);
  const [draft, setDraft] = useState<string>(String(initialTarget));
  const [error, setError] = useState<string>('');
  const [saving, startTransition] = useTransition();

  const achievementPct = target > 0 ? Math.round((periodJoinUnits / target) * 100) : 0;

  const onSave = () => {
    setError('');
    const n = Number(draft);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0 || n > 10000) {
      setError('1 이상 10000 이하 정수만 입력 가능합니다.');
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch('/api/me/monthly-target', {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ monthly_target_units: n }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(json?.error ?? '저장 실패');
          return;
        }
        setTarget(n);
        setEditing(false);
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  return (
    <section className="mb-3 overflow-hidden rounded-2xl border border-orange-200/80 bg-gradient-to-br from-orange-50 via-white to-white p-3 shadow-sm ring-1 ring-orange-200/40 sm:mb-4 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-orange-700/80">
            이번 달 목표
          </p>
          <p className="mt-1 text-sm text-slate-700">
            <span className="text-lg font-semibold tabular-nums text-slate-900 sm:text-xl">
              {target.toLocaleString('ko-KR')}
            </span>
            <span className="ml-0.5 text-xs text-slate-500">구좌</span>
            <span className="mx-2 text-slate-300">·</span>
            누적 <span className="font-semibold tabular-nums text-slate-900">
              {periodJoinUnits.toLocaleString('ko-KR')}
            </span> 구좌
            <span className="mx-2 text-slate-300">·</span>
            <span
              className={
                achievementPct >= 100
                  ? 'font-semibold text-emerald-600'
                  : achievementPct >= 50
                  ? 'font-semibold text-orange-600'
                  : 'font-semibold text-slate-500'
              }
            >
              달성률 {achievementPct}%
            </span>
          </p>
        </div>
        {canEdit && !editing && (
          <button
            type="button"
            onClick={() => {
              setDraft(String(target));
              setEditing(true);
              setError('');
            }}
            className="rounded-lg border border-orange-300 bg-white px-2.5 py-1 text-xs font-medium text-orange-700 shadow-sm hover:bg-orange-50"
          >
            수정
          </button>
        )}
      </div>

      {/* 달성률 게이지 */}
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-orange-100/70">
        <div
          className={
            'h-full rounded-full transition-all ' +
            (achievementPct >= 100 ? 'bg-emerald-500' : 'bg-orange-500')
          }
          style={{ width: `${Math.min(100, Math.max(0, achievementPct))}%` }}
        />
      </div>

      {editing && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={10000}
            step={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={saving}
            className="w-24 rounded border border-orange-300 px-2 py-1 text-sm tabular-nums"
            autoFocus
          />
          <span className="text-xs text-slate-500">구좌</span>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded bg-orange-600 px-3 py-1 text-xs font-medium text-white hover:bg-orange-700 disabled:opacity-60"
          >
            {saving ? '저장 중…' : '저장'}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setError('');
            }}
            disabled={saving}
            className="rounded border px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
          >
            취소
          </button>
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      )}
    </section>
  );
}
