'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import SimpleAlertModal from '@/components/ui/SimpleAlertModal';

const CODE_REQUEST_SUBMIT_NOTICE =
  '※ 주민등록번호 및 계좌번호는 개인정보 보호를 위해 본사 매니저에게 카카오톡 개인 메시지로 전달 부탁드립니다.';

type Item = {
  id: string;
  name: string;
  birth_date: string;
  gender: '남' | '여' | string;
  phone: string;
  has_own_contract: boolean;
  memo: string | null;
  status: string;
  requested_at: string;
  synced_to_sheet: boolean;
  sheet_synced_at: string | null;
  rejection_reason?: string | null;
  rejected_at?: string | null;
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return iso;
  }
}

function fmtBirth(b: string): string {
  const d = (b ?? '').replace(/\D/g, '');
  if (d.length !== 8) return b;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case '시트등록완료':
      return 'bg-blue-100 text-blue-700';
    case '처리완료':
      return 'bg-emerald-100 text-emerald-700';
    case '반려':
      return 'bg-red-100 text-red-700';
    case '신청중':
    default:
      return 'bg-amber-100 text-amber-700';
  }
}

/**
 * 사용자(영업자) 화면 표시용 상태 레이블.
 *   DB '시트등록완료' → 화면 '처리중'
 *   그 외 status 는 그대로 노출.
 *
 * 관리자 화면(/admin/newcode)은 기존 UX 유지(시트등록완료 그대로 표기).
 */
function statusDisplayLabel(status: string): string {
  if (status === '시트등록완료') return '처리중';
  return status;
}

export default function CodeRequestClient({
  initialItems,
  canSubmit,
}: {
  initialItems: Item[];
  canSubmit: boolean;
}) {
  const [items, setItems] = useState<Item[]>(initialItems);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [birth, setBirth] = useState('');
  const [gender, setGender] = useState<'남' | '여' | ''>('');
  const [phone, setPhone] = useState('');
  const [hasOwn, setHasOwn] = useState<'yes' | 'no' | ''>('');
  const [memo, setMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [submitNoticeOpen, setSubmitNoticeOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const formRef = useRef<HTMLDivElement>(null);

  const reset = () => {
    setEditingId(null);
    setName('');
    setBirth('');
    setGender('');
    setPhone('');
    setHasOwn('');
    setMemo('');
  };

  const startEdit = (it: Item) => {
    setError('');
    setOk('');
    setEditingId(it.id);
    setName(it.name);
    setBirth((it.birth_date ?? '').replace(/\D/g, ''));
    setGender(it.gender === '남' || it.gender === '여' ? (it.gender as '남' | '여') : '');
    setPhone(it.phone ?? '');
    setHasOwn(it.has_own_contract ? 'yes' : 'no');
    setMemo(it.memo ?? '');
    // 폼으로 스크롤
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const cancelEdit = () => {
    reset();
    setError('');
    setOk('');
  };

  const remove = useCallback(async (id: string) => {
    if (!confirm('이 신청 내역을 삭제하시겠습니까?')) return;
    setError('');
    setOk('');
    setDeletingId(id);
    try {
      const res = await fetch(`/api/me/sales-code-requests/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error ?? '삭제 실패');
        return;
      }
      setItems((prev) => prev.filter((x) => x.id !== id));
      if (editingId === id) reset();
      setOk('삭제되었습니다.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeletingId(null);
    }
  }, [editingId]);

  const submit = useCallback(async () => {
    setError('');
    setOk('');
    if (!canSubmit) {
      setError('계정 매핑이 완료된 영업자만 신청할 수 있습니다.');
      return;
    }
    if (!name.trim()) return setError('이름을 입력하세요');
    const birthDigits = birth.replace(/\D/g, '');
    if (birthDigits.length !== 8) return setError('생년월일은 8자리 (예: 19990101)');
    if (gender !== '남' && gender !== '여') return setError('성별을 선택하세요');
    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length < 10 || phoneDigits.length > 11) return setError('전화번호 형식이 올바르지 않습니다');
    if (hasOwn === '') return setError('본인 가입구좌 유무를 선택하세요');
    if (hasOwn === 'no' && !memo.trim()) return setError('본인 가입구좌가 없을 경우 사유 메모를 입력하세요');

    setSubmitting(true);
    try {
      const url = editingId
        ? `/api/me/sales-code-requests/${editingId}`
        : '/api/me/sales-code-requests';
      const method = editingId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          birth_date: birthDigits,
          gender,
          phone: phoneDigits,
          has_own_contract: hasOwn === 'yes',
          memo: hasOwn === 'no' ? memo.trim() : null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error ?? (editingId ? '수정 실패' : '신청 실패'));
        return;
      }
      const updated = json?.item as Item | undefined;
      if (editingId && updated) {
        setItems((prev) => prev.map((x) => (x.id === editingId ? updated : x)));
        setOk('수정되었습니다.');
      } else if (updated) {
        setItems((prev) => [updated, ...prev]);
        setSubmitNoticeOpen(true);
      }
      reset();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, name, birth, gender, phone, hasOwn, memo, editingId]);

  useEffect(() => {
    if (!ok) return;
    const t = setTimeout(() => setOk(''), 2500);
    return () => clearTimeout(t);
  }, [ok]);

  const isEdit = !!editingId;

  return (
    <>
      <SimpleAlertModal
        open={submitNoticeOpen}
        variant="success"
        title="신청이 접수되었습니다"
        message={CODE_REQUEST_SUBMIT_NOTICE}
        onClose={() => setSubmitNoticeOpen(false)}
      />

      {/* 신청 폼 (생성/수정 공용) */}
      <section
        ref={formRef}
        className="mb-4 overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.035] sm:p-5"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900 sm:text-base">
            {isEdit ? '신청서 수정' : '새 신청서 작성'}
          </h2>
          {isEdit && (
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
              신청중 항목 수정
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[11px] text-slate-500">
          {isEdit
            ? '수정 후 [수정 저장] 버튼을 누르세요. 시트 동기화 이후에는 수정할 수 없습니다.'
            : (
              <>
                작성 후 [신청] 버튼을 누르면 관리자에게 전달됩니다.
              </>
            )}
        </p>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">이름 *</label>
            <input
              type="text"
              inputMode="text"
              autoComplete="name"
              lang="ko"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="홍길동"
              className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
              disabled={submitting}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">생년월일 * (8자리)</label>
            <input
              value={birth}
              onChange={(e) => setBirth(e.target.value)}
              inputMode="numeric"
              maxLength={8}
              placeholder="예: 19990101"
              className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm tabular-nums"
              disabled={submitting}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">성별 *</label>
            <div className="flex gap-3 text-sm">
              {(['남', '여'] as const).map((g) => (
                <label key={g} className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="gender"
                    value={g}
                    checked={gender === g}
                    onChange={() => setGender(g)}
                    disabled={submitting}
                  />
                  {g}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">전화번호 *</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              placeholder="예: 010-1234-1234"
              className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm tabular-nums"
              disabled={submitting}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-700">본인 가입구좌 유무 *</label>
            <div className="flex flex-wrap gap-3 text-sm">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="has_own"
                  value="yes"
                  checked={hasOwn === 'yes'}
                  onChange={() => setHasOwn('yes')}
                  disabled={submitting}
                />
                예
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="has_own"
                  value="no"
                  checked={hasOwn === 'no'}
                  onChange={() => setHasOwn('no')}
                  disabled={submitting}
                />
                아니오
              </label>
            </div>
          </div>
          {hasOwn === 'no' && (
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-700">사유 메모 *</label>
              <textarea
                lang="ko"
                inputMode="text"
                autoComplete="off"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                rows={2}
                placeholder="예) 다른 사람 이름으로 가입 / 특이사항 있음"
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                disabled={submitting}
              />
            </div>
          )}
        </div>

        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        {ok && <p className="mt-2 text-xs text-emerald-700">{ok}</p>}

        <div className="mt-3 flex justify-end gap-2">
          {isEdit ? (
            <button
              type="button"
              onClick={cancelEdit}
              disabled={submitting}
              className="rounded border px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              취소
            </button>
          ) : (
            <button
              type="button"
              onClick={reset}
              disabled={submitting}
              className="rounded border px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              초기화
            </button>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !canSubmit}
            className="rounded bg-orange-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-orange-700 disabled:opacity-60"
          >
            {submitting ? (isEdit ? '저장 중…' : '신청 중…') : isEdit ? '수정 저장' : '신청'}
          </button>
        </div>
        {!canSubmit && (
          <p className="mt-2 text-[11px] text-amber-700">
            계정 매핑이 완료되지 않은 사전발급 계정에서는 신청할 수 없습니다.
          </p>
        )}
      </section>

      {/* 본인 신청 리스트 */}
      <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-900/[0.035]">
        <header className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900 sm:text-base">내 신청 내역</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">총 {items.length}건 (신청중 항목만 수정/삭제 가능)</p>
        </header>
        <div className="overflow-x-auto">
          <table className="min-w-full whitespace-nowrap text-xs sm:text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="whitespace-nowrap px-3 py-2 text-left font-medium">신청일</th>
                <th className="whitespace-nowrap px-3 py-2 text-left font-medium">이름</th>
                <th className="whitespace-nowrap px-3 py-2 text-left font-medium">생년월일</th>
                <th className="whitespace-nowrap px-3 py-2 text-left font-medium">성별</th>
                <th className="whitespace-nowrap px-3 py-2 text-left font-medium">전화번호</th>
                <th className="whitespace-nowrap px-3 py-2 text-left font-medium">본인 가입구좌</th>
                <th className="whitespace-nowrap px-3 py-2 text-left font-medium">상태</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">동작</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-slate-400">
                    아직 신청 내역이 없습니다.
                  </td>
                </tr>
              ) : (
                items.map((it) => {
                  const editable = it.status === '신청중' && !it.synced_to_sheet;
                  const isThisDeleting = deletingId === it.id;
                  const isThisEditing = editingId === it.id;
                  const isRejected = it.status === '반려';
                  return (
                    <Fragment key={it.id}>
                      <tr
                        className={`border-t border-slate-100 ${isThisEditing ? 'bg-orange-50/60' : ''}`}
                      >
                        <td className="whitespace-nowrap px-3 py-2 text-slate-700 tabular-nums">{fmtDateTime(it.requested_at)}</td>
                        <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-900">{it.name}</td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-700">{fmtBirth(it.birth_date)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-700">{it.gender}</td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-700">{it.phone}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-700">{it.has_own_contract ? '예' : '아니오'}</td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusBadgeClass(
                              it.status,
                            )}`}
                          >
                            {statusDisplayLabel(it.status)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          {editable ? (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => startEdit(it)}
                                disabled={submitting || isThisDeleting}
                                className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                              >
                                {isThisEditing ? '수정중…' : '수정'}
                              </button>
                              <button
                                type="button"
                                onClick={() => remove(it.id)}
                                disabled={submitting || isThisDeleting}
                                className="rounded border border-red-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                              >
                                {isThisDeleting ? '삭제중…' : '삭제'}
                              </button>
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-300">-</span>
                          )}
                        </td>
                      </tr>
                      {isRejected && (it.rejection_reason ?? '').trim() !== '' && (
                        <tr className="border-t border-red-100 bg-red-50/60">
                          <td colSpan={8} className="px-3 py-2 align-top">
                            <div className="flex flex-col gap-1 text-[12px] text-red-700 sm:flex-row sm:items-start sm:gap-2">
                              <span className="inline-flex shrink-0 items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                                반려 사유
                              </span>
                              <span className="whitespace-pre-wrap break-words">{it.rejection_reason}</span>
                              {it.rejected_at && (
                                <span className="ml-auto shrink-0 text-[11px] text-red-500 tabular-nums">
                                  {fmtDateTime(it.rejected_at)}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.035] sm:p-5">
        <h2 className="text-sm font-semibold text-slate-900 sm:text-base">담당자 변경</h2>
        <p className="mt-1 text-xs text-slate-500">본인 산하 계약의 담당자 변경을 신청할 수 있습니다.</p>
        <Link
          href="/organization/manager-change"
          className="mt-3 inline-flex min-h-9 items-center justify-center rounded-lg border border-orange-200 bg-orange-50 px-4 text-sm font-semibold text-orange-800 transition hover:bg-orange-100"
        >
          담당자 변경 신청
        </Link>
      </section>
    </>
  );
}
