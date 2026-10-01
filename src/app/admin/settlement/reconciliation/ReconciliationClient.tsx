'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { formatKRW } from '@/lib/settlement/calculator';
import type {
  ReconciliationDetailRow,
  ReconciliationMemberRow,
} from '@/lib/settlement/reconciliation';

type ApiResult = {
  success: true;
  yearMonth: string;
  files: string[];
  warnings: string[];
  summary: {
    headquartersContractCount: number;
    systemContractCount: number;
    matchedContractCount: number;
    mismatchedContractCount: number;
    differentMemberCount: number;
  };
  members: ReconciliationMemberRow[];
  unmatchedDetails: ReconciliationDetailRow[];
};

function reasonClass(reason: ReconciliationDetailRow['reason']): string {
  if (reason === '정상') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (reason === '본사 환수 계약') return 'bg-violet-50 text-violet-700 ring-violet-200';
  return 'bg-amber-50 text-amber-800 ring-amber-200';
}

function Amount({ value }: { value: number | null }) {
  if (value == null) return <span className="text-slate-400">미산출</span>;
  return (
    <span className={value < 0 ? 'text-rose-700' : ''}>
      {formatKRW(value)}
    </span>
  );
}

function DetailTable({ rows }: { rows: ReconciliationDetailRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-[1380px] w-full text-left text-xs">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            {[
              '계약코드',
              '고객명',
              '상품',
              '본사 엑셀',
              '본사 정산액',
              '시스템 수당',
              '예상 수당',
              '수당 종류',
              '차이 원인',
              '조직 경로',
              '상위 직급',
              '하위 직급',
              '상위 단가',
              '하위 단가',
              '구좌',
              '롤업수당',
            ].map((label) => (
              <th key={label} className="whitespace-nowrap px-3 py-2 font-semibold">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.id} className="align-top">
              <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-slate-700">
                {row.contractCode}
              </td>
              <td className="whitespace-nowrap px-3 py-2">{row.customerName || '-'}</td>
              <td className="max-w-48 px-3 py-2">{row.productName || '-'}</td>
              <td className="whitespace-nowrap px-3 py-2">
                {row.excelPresent ? '있음' : '없음'}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                <Amount value={row.headquartersAmount} />
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                <Amount value={row.systemAmount} />
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                <Amount value={row.expectedAmount} />
              </td>
              <td className="whitespace-nowrap px-3 py-2">{row.payoutType}</td>
              <td className="px-3 py-2">
                <span
                  className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] ring-1 ${reasonClass(row.reason)}`}
                >
                  {row.reason}
                </span>
                {row.reason === '담당자 매칭 차이' && (
                  <div className="mt-1 text-[10px] text-slate-500">
                    엑셀 {row.excelOwner || '-'} / 시스템 {row.effectiveOwnerName || '-'}
                  </div>
                )}
              </td>
              <td className="max-w-64 px-3 py-2 text-slate-600">
                {row.organizationPath || '-'}
              </td>
              <td className="whitespace-nowrap px-3 py-2">{row.upperRank || '-'}</td>
              <td className="whitespace-nowrap px-3 py-2">{row.lowerRank || '-'}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                {row.upperUnitPrice == null ? '-' : formatKRW(row.upperUnitPrice)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                {row.lowerUnitPrice == null ? '-' : formatKRW(row.lowerUnitPrice)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                {row.unitCount || '-'}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                {row.payoutType === '롤업수당' ? formatKRW(row.systemAmount) : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ReconciliationClient({
  initialYearMonth,
}: {
  initialYearMonth: string;
}) {
  const [yearMonth, setYearMonth] = useState(initialYearMonth);
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openMemberIds, setOpenMemberIds] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);

  const visibleMembers = useMemo(
    () =>
      result?.members.filter(
        (row) => showAll || row.difference !== 0 || row.unresolvedCount > 0,
      ) ?? [],
    [result, showAll],
  );

  const submit = async () => {
    if (files.length === 0) {
      setError('본사 정산 엑셀 파일을 선택해 주세요.');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setOpenMemberIds(new Set());
    try {
      const body = new FormData();
      body.set('year_month', yearMonth);
      for (const file of files) body.append('files', file);
      const response = await fetch('/api/admin/settlement/reconciliation', {
        method: 'POST',
        body,
      });
      const json = (await response.json()) as ApiResult | { error?: string };
      if (!response.ok || !('success' in json) || !json.success) {
        throw new Error(('error' in json && json.error) || '대사 처리에 실패했습니다.');
      }
      setResult(json);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '대사 처리에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const toggleMember = (memberId: string) => {
    setOpenMemberIds((previous) => {
      const next = new Set(previous);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  };

  return (
    <div className="p-3 sm:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-orange-800/80">
            관리자
          </p>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            본사 정산 검증
          </h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-600">
            본사 엑셀의 계약 목록과 현재 시스템 정산에 반영된 계약 목록을 대조합니다.
            본사 수수료와 직원 수당 금액을 직접 비교하거나 정산 데이터를 수정하지 않습니다.
          </p>
        </div>
        <Link
          href={`/admin/settlement?year_month=${yearMonth}`}
          className="inline-flex shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          정산 현황으로 돌아가기
        </Link>
      </div>

      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)_auto] lg:items-end">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-700">정산월</span>
            <input
              type="month"
              value={yearMonth}
              onChange={(event) => setYearMonth(event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-700">
              본사 정산서 (.xlsx, 여러 파일 가능)
            </span>
            <input
              type="file"
              multiple
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs file:mr-3 file:rounded file:border-0 file:bg-orange-50 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-orange-800"
            />
            {files.length > 0 && (
              <p className="mt-1 text-[11px] text-slate-500">
                {files.length}개 선택: {files.map((file) => file.name).join(', ')}
              </p>
            )}
          </label>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={loading || !yearMonth || files.length === 0}
            className="inline-flex h-10 items-center justify-center rounded-md bg-orange-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? '검증 중…' : '계약 목록 대조'}
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}
      </section>

      {result && (
        <>
          {result.warnings.length > 0 && (
            <section className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-xs font-semibold text-amber-900">확인 필요</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-amber-800">
                {result.warnings.map((warning, index) => (
                  <li key={`${warning}-${index}`}>{warning}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
            {[
              ['본사 정산 계약 수', result.summary.headquartersContractCount],
              ['시스템 정산 계약 수', result.summary.systemContractCount],
              ['일치 계약 수', result.summary.matchedContractCount],
              ['불일치 계약 수', result.summary.mismatchedContractCount],
              ['차이 담당자 수', result.summary.differentMemberCount],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <p className="text-[11px] text-slate-500">{label}</p>
                <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">
                  {Number(value).toLocaleString('ko-KR')}
                </p>
              </div>
            ))}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">담당자별 대사 결과</h2>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  현재·예상 금액은 계약 귀속 수당만 포함하며 보너스와 수동 조정은 제외합니다.
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={showAll}
                  onChange={(event) => setShowAll(event.target.checked)}
                />
                일치 담당자 포함
              </label>
            </div>
            <div className="hidden grid-cols-[minmax(120px,1fr)_repeat(3,minmax(110px,0.7fr))_36px] gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 text-[11px] font-semibold text-slate-500 sm:grid">
              <span>담당자</span>
              <span className="text-right">현재 시스템 정산액</span>
              <span className="text-right">본사 계약 기준 예상액</span>
              <span className="text-right">차이</span>
              <span />
            </div>
            <div className="divide-y divide-slate-100">
              {visibleMembers.map((member) => {
                const open = openMemberIds.has(member.memberId);
                return (
                  <div key={member.memberId}>
                    <button
                      type="button"
                      onClick={() => toggleMember(member.memberId)}
                      className="grid w-full grid-cols-[minmax(120px,1fr)_repeat(3,minmax(110px,0.7fr))_36px] items-center gap-2 px-4 py-3 text-left hover:bg-slate-50"
                    >
                      <span className="font-semibold text-slate-800">{member.memberName}</span>
                      <span className="text-right text-xs tabular-nums text-slate-600">
                        {formatKRW(member.currentAmount)}
                      </span>
                      <span className="text-right text-xs tabular-nums text-slate-600">
                        {formatKRW(member.expectedAmount)}
                        {member.unresolvedCount > 0 && (
                          <span className="ml-1 text-[10px] text-amber-700">
                            + {member.unresolvedCount}건 미산출
                          </span>
                        )}
                      </span>
                      <span
                        className={`text-right text-xs font-semibold tabular-nums ${
                          member.difference === 0 && member.unresolvedCount === 0
                            ? 'text-emerald-700'
                            : 'text-rose-700'
                        }`}
                      >
                        {formatKRW(member.difference)}
                      </span>
                      <span className="text-center text-slate-400">{open ? '−' : '+'}</span>
                    </button>
                    {open && (
                      <div className="border-t border-slate-100 bg-slate-50/70 p-3">
                        <DetailTable rows={member.detailRows} />
                      </div>
                    )}
                  </div>
                );
              })}
              {visibleMembers.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-slate-500">
                  차이가 있는 담당자가 없습니다.
                </p>
              )}
            </div>
          </section>

          {result.unmatchedDetails.length > 0 && (
            <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50/40 p-4">
              <h2 className="text-sm font-bold text-amber-950">담당자 미매칭 계약</h2>
              <p className="mb-3 mt-1 text-xs text-amber-800">
                계약코드가 시스템 계약 또는 조직 담당자와 연결되지 않아 담당자별 합계에 포함하지 못했습니다.
              </p>
              <DetailTable rows={result.unmatchedDetails} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
