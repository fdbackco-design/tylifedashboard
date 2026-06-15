'use client';

/**
 * 관리자 명세서 관리 클라이언트.
 *
 * - 영업자 행마다 [수정] 버튼으로 모달을 열어 표시값을 보정한다.
 * - 빈값(공란) 으로 저장하면 NULL → 기본값(monthly_settlements 원본) 사용.
 * - 모든 변경은 /api/admin/settlement-sheet/[memberId] PUT 으로 settlement_statement_overrides 만 갱신.
 * - "엑셀 다운로드" 버튼은 /api/admin/settlement-sheet/export 호출 (CSV, BOM 포함, .csv 다운로드).
 */

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RankType } from '@/lib/types';

export interface SheetRowVM {
  memberId: string;
  name: string;
  rank: RankType;
  phone: string;
  tyCode: string;
  base: {
    personalUnitCount: number;
    downlineUnitCount: number;
    personalCommission: number;
    overrideAmount: number;
    bonusAmount: number;
  };
  override: {
    id: string;
    personalUnitCount: number | null;
    downlineUnitCount: number | null;
    personalCommission: number | null;
    overrideAmount: number | null;
    bonusAmount: number | null;
    memo: string;
  } | null;
}

interface Props {
  yearMonth: string;
  yearMonthLabelKo: string;
  displayWindowKo: string;
  rows: SheetRowVM[];
}

/**
 * 공유 명세서 상대 경로(렌더 안정성을 위해 origin 은 포함하지 않는다).
 * - 서버 렌더와 클라이언트 hydration 시 동일한 값이 나오도록 window 를 참조하지 않는다.
 * - 실제 절대 URL 은 클립보드 복사 시점에 `window.location.origin` 과 결합한다.
 */
function buildSharePath(tyCode: string, yearMonth: string): string {
  if (!tyCode) return '';
  return `/organization/statement/${encodeURIComponent(tyCode)}?year_month=${encodeURIComponent(yearMonth)}`;
}

function toAbsoluteUrl(path: string): string {
  if (!path) return '';
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}

function effectiveValue(override: number | null | undefined, base: number): number {
  return override == null ? base : override;
}

function fmtWon(n: number): string {
  return Math.round(n).toLocaleString('ko-KR');
}

function fmtUnits(n: number): string {
  return n.toLocaleString('ko-KR');
}

export default function SettlementSheetAdminClient({
  yearMonth,
  yearMonthLabelKo,
  displayWindowKo,
  rows,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<SheetRowVM | null>(null);
  // 입력 중인 값(searchInput)과 실제 적용된 검색어(filter)를 분리.
  // 사용자가 엔터를 누르거나 "검색" 버튼을 눌렀을 때만 filter 가 갱신되어 표가 재필터된다.
  const [searchInput, setSearchInput] = useState('');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "링크" 버튼 클릭 직후 잠깐 체크 표시를 띄울 행의 memberId.
  const [copiedMemberId, setCopiedMemberId] = useState<string | null>(null);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filteredRows = useMemo(() => {
    const f = filter.trim();
    if (!f) return rows;
    const lower = f.toLowerCase();
    const digits = f.replace(/\D+/g, '');
    return rows.filter((r) => {
      if (r.name.toLowerCase().includes(lower)) return true;
      if (r.tyCode && r.tyCode.toLowerCase().includes(lower)) return true;
      // 전화번호는 입력에 숫자가 한 자리 이상 있을 때만 매칭. 그렇지 않으면
      // `''.includes('')` 가 항상 true 가 되어 모든 행이 들어가는 버그가 생긴다.
      if (digits.length > 0) {
        const phoneDigits = r.phone.replace(/\D+/g, '');
        if (phoneDigits.includes(digits)) return true;
      }
      return false;
    });
  }, [rows, filter]);

  function onSubmitSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFilter(searchInput);
  }

  function onClearSearch() {
    setSearchInput('');
    setFilter('');
  }

  async function onExport() {
    setError(null);
    const url = `/api/admin/settlement-sheet/export?year_month=${encodeURIComponent(yearMonth)}`;
    window.location.href = url;
  }

  async function onCopyShareLink(memberId: string, sharePath: string) {
    setError(null);
    try {
      await navigator.clipboard.writeText(toAbsoluteUrl(sharePath));
    } catch {
      setError('복사에 실패했습니다.');
      return;
    }
    setCopiedMemberId(memberId);
    if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
    copiedTimeoutRef.current = setTimeout(() => {
      setCopiedMemberId(null);
      copiedTimeoutRef.current = null;
    }, 1500);
  }

  return (
    <div>
      {error ? (
        <div className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800">
          {error}
        </div>
      ) : null}

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <form
          onSubmit={onSubmitSearch}
          className="flex w-full items-center gap-2 sm:w-auto"
          role="search"
        >
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="이름·전화번호로 검색 (엔터)"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200 sm:w-72"
          />
          <button
            type="submit"
            className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 sm:text-sm"
          >
            검색
          </button>
          {filter ? (
            <button
              type="button"
              onClick={onClearSearch}
              className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-500 shadow-sm transition hover:bg-slate-50 sm:text-sm"
            >
              초기화
            </button>
          ) : null}
        </form>
        <button
          type="button"
          onClick={onExport}
          className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 sm:text-sm"
        >
          엑셀 다운로드
        </button>
      </div>

      <div className="overflow-auto rounded-xl border border-slate-200">
        <table className="min-w-[1000px] w-full text-xs sm:text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-slate-600">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">영업자</th>
              <th className="px-3 py-2 font-medium">직책</th>
              <th className="px-3 py-2 font-medium">전화번호</th>
              <th className="px-3 py-2 text-right font-medium">개인구좌</th>
              <th className="px-3 py-2 text-right font-medium">산하구좌</th>
              <th className="px-3 py-2 text-right font-medium">개인수당</th>
              <th className="px-3 py-2 text-right font-medium">오버라이드</th>
              <th className="px-3 py-2 text-right font-medium">보너스</th>
              <th className="px-3 py-2 text-center font-medium">동작</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-slate-500">
                  표시할 영업자가 없습니다.
                </td>
              </tr>
            ) : (
              filteredRows.map((r) => {
                const pu = effectiveValue(r.override?.personalUnitCount, r.base.personalUnitCount);
                const du = effectiveValue(r.override?.downlineUnitCount, r.base.downlineUnitCount);
                const pc = effectiveValue(r.override?.personalCommission, r.base.personalCommission);
                const ov = effectiveValue(r.override?.overrideAmount, r.base.overrideAmount);
                const bn = effectiveValue(r.override?.bonusAmount, r.base.bonusAmount);
                const hasOverride = !!r.override && (
                  r.override.personalUnitCount != null ||
                  r.override.downlineUnitCount != null ||
                  r.override.personalCommission != null ||
                  r.override.overrideAmount != null ||
                  r.override.bonusAmount != null
                );
                const sharePath = buildSharePath(r.tyCode, yearMonth);
                return (
                  <tr key={r.memberId} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-3 py-2 font-medium text-slate-900">
                      {r.name}
                      {hasOverride ? (
                        <span className="ml-1 inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-800 ring-1 ring-amber-200">
                          보정
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-slate-700">{r.rank}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-600">{r.phone || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-900">{fmtUnits(pu)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-900">{fmtUnits(du)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-900">{fmtWon(pc)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-900">{fmtWon(ov)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-900">{fmtWon(bn)}</td>
                    <td className="px-3 py-2 text-center">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                          onClick={() => setEditing(r)}
                        >
                          수정
                        </button>
                        {sharePath ? (
                          <button
                            type="button"
                            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                            onClick={() => onCopyShareLink(r.memberId, sharePath)}
                            title={sharePath}
                          >
                            링크
                          </button>
                        ) : null}
                        <span
                          aria-hidden={copiedMemberId !== r.memberId}
                          className={`inline-flex h-5 w-5 items-center justify-center rounded-full bg-lime-100 text-lime-600 ring-1 ring-lime-300 transition-opacity duration-200 ${
                            copiedMemberId === r.memberId ? 'opacity-100' : 'pointer-events-none opacity-0'
                          }`}
                          title="복사됨"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            className="h-3.5 w-3.5"
                          >
                            <path
                              fillRule="evenodd"
                              d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.42 0l-3.5-3.5a1 1 0 011.42-1.42L8.5 12.08l6.79-6.79a1 1 0 011.42 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
        <strong>보정값</strong>이 설정된 행은 영업자 명세서 표시에 보정값이 우선 반영됩니다.
        보정값을 비워두면 정산 원본(자동 계산값)이 그대로 표시됩니다. 정산 계산 자체는 변경되지
        않습니다.
      </p>

      {editing ? (
        <EditOverrideModal
          yearMonth={yearMonth}
          yearMonthLabelKo={yearMonthLabelKo}
          displayWindowKo={displayWindowKo}
          row={editing}
          busy={busy}
          setBusy={setBusy}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
          onError={(m) => setError(m)}
        />
      ) : null}
    </div>
  );
}

function toIntOrNull(s: string): { ok: boolean; value: number | null } {
  const t = s.trim();
  if (t === '') return { ok: true, value: null };
  if (!/^-?\d+$/.test(t)) return { ok: false, value: null };
  const n = parseInt(t, 10);
  if (!Number.isFinite(n)) return { ok: false, value: null };
  return { ok: true, value: n };
}

function EditOverrideModal({
  yearMonth,
  yearMonthLabelKo,
  displayWindowKo,
  row,
  busy,
  setBusy,
  onClose,
  onSaved,
  onError,
}: {
  yearMonth: string;
  yearMonthLabelKo: string;
  displayWindowKo: string;
  row: SheetRowVM;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [personalUnit, setPersonalUnit] = useState(
    row.override?.personalUnitCount != null ? String(row.override.personalUnitCount) : '',
  );
  const [downlineUnit, setDownlineUnit] = useState(
    row.override?.downlineUnitCount != null ? String(row.override.downlineUnitCount) : '',
  );
  const [personalCommission, setPersonalCommission] = useState(
    row.override?.personalCommission != null ? String(row.override.personalCommission) : '',
  );
  const [overrideAmount, setOverrideAmount] = useState(
    row.override?.overrideAmount != null ? String(row.override.overrideAmount) : '',
  );
  const [bonus, setBonus] = useState(
    row.override?.bonusAmount != null ? String(row.override.bonusAmount) : '',
  );
  const [memo, setMemo] = useState(row.override?.memo ?? '');

  async function save(action: 'upsert' | 'reset') {
    onError('');
    const fields = {
      personal_unit_count: toIntOrNull(personalUnit),
      downline_unit_count: toIntOrNull(downlineUnit),
      personal_commission: toIntOrNull(personalCommission),
      override_amount: toIntOrNull(overrideAmount),
      bonus_amount: toIntOrNull(bonus),
    };
    for (const k of Object.keys(fields) as Array<keyof typeof fields>) {
      if (!fields[k].ok) {
        onError(`${k} 값이 정수가 아닙니다.`);
        return;
      }
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/settlement-sheet/${encodeURIComponent(row.memberId)}`, {
        method: action === 'reset' ? 'DELETE' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year_month: yearMonth,
          personal_unit_count: fields.personal_unit_count.value,
          downline_unit_count: fields.downline_unit_count.value,
          personal_commission: fields.personal_commission.value,
          override_amount: fields.override_amount.value,
          bonus_amount: fields.bonus_amount.value,
          memo: memo.trim() || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        onError(`저장 실패: ${j?.error ?? res.status}`);
        return;
      }
      onSaved();
    } catch {
      onError('네트워크 오류로 저장에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-3">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">{row.name} · 명세서 보정</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {yearMonthLabelKo} · {displayWindowKo}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
            disabled={busy}
          >
            닫기
          </button>
        </div>
        <div className="space-y-3 p-4 text-sm">
          <p className="text-[11px] text-slate-500">
            빈값(공란)으로 저장하면 해당 항목은 <strong>자동 계산값(원본)</strong>이 그대로
            사용됩니다.
          </p>
          <FieldRow
            label="개인 실적 구좌"
            base={row.base.personalUnitCount.toLocaleString('ko-KR')}
            value={personalUnit}
            onChange={setPersonalUnit}
            placeholder="자동 계산값 사용"
            disabled={busy}
          />
          <FieldRow
            label="산하 실적 구좌"
            base={row.base.downlineUnitCount.toLocaleString('ko-KR')}
            value={downlineUnit}
            onChange={setDownlineUnit}
            placeholder="자동 계산값 사용"
            disabled={busy}
          />
          <FieldRow
            label="개인 수당 (원)"
            base={row.base.personalCommission.toLocaleString('ko-KR')}
            value={personalCommission}
            onChange={setPersonalCommission}
            placeholder="자동 계산값 사용"
            disabled={busy}
          />
          <FieldRow
            label="오버라이드 (원)"
            base={row.base.overrideAmount.toLocaleString('ko-KR')}
            value={overrideAmount}
            onChange={setOverrideAmount}
            placeholder="자동 계산값 사용"
            disabled={busy}
          />
          <FieldRow
            label="보너스 (원)"
            base={row.base.bonusAmount.toLocaleString('ko-KR')}
            value={bonus}
            onChange={setBonus}
            placeholder="자동 계산값 사용"
            disabled={busy}
          />
          <div>
            <label className="block text-xs font-medium text-slate-700">메모</label>
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"
              placeholder="(선택) 관리자 메모"
              disabled={busy}
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
          <button
            type="button"
            onClick={() => save('reset')}
            disabled={busy}
            className="rounded-md border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
          >
            보정값 전체 삭제
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => save('upsert')}
              disabled={busy}
              className="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-orange-700 disabled:opacity-60"
            >
              {busy ? '저장 중…' : '저장'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldRow({
  label,
  base,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  label: string;
  base: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 items-center gap-2">
      <label className="col-span-1 text-xs font-medium text-slate-700">{label}</label>
      <div className="col-span-2 flex items-center gap-2">
        <input
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm tabular-nums text-slate-900 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200 disabled:bg-slate-50"
        />
        <span className="shrink-0 text-[11px] text-slate-500">기본: {base}</span>
      </div>
    </div>
  );
}
