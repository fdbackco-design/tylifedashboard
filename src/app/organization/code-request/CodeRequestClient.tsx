'use client';

import { useCallback, useState } from 'react';

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

export default function CodeRequestClient({
  initialItems,
  canSubmit,
}: {
  initialItems: Item[];
  canSubmit: boolean;
}) {
  const [items, setItems] = useState<Item[]>(initialItems);
  const [name, setName] = useState('');
  const [birth, setBirth] = useState('');
  const [gender, setGender] = useState<'남' | '여' | ''>('');
  const [phone, setPhone] = useState('');
  const [hasOwn, setHasOwn] = useState<'yes' | 'no' | ''>('');
  const [memo, setMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  const reset = () => {
    setName('');
    setBirth('');
    setGender('');
    setPhone('');
    setHasOwn('');
    setMemo('');
  };

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
      const res = await fetch('/api/me/sales-code-requests', {
        method: 'POST',
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
        setError(json?.error ?? '신청 실패');
        return;
      }
      if (json?.item) {
        setItems((prev) => [json.item as Item, ...prev]);
      }
      setOk('신청이 접수되었습니다.');
      reset();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, name, birth, gender, phone, hasOwn, memo]);

  return (
    <>
      {/* 신청 폼 */}
      <section className="mb-4 overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.035] sm:p-5">
        <h2 className="text-sm font-semibold text-slate-900 sm:text-base">새 신청서 작성</h2>
        <p className="mt-0.5 text-[11px] text-slate-500">
          작성 후 [신청] 버튼을 누르면 관리자에게 전달됩니다. 기본 상태는 <b>신청중</b> 입니다.
        </p>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">이름 *</label>
            <input
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
          <button
            type="button"
            onClick={reset}
            disabled={submitting}
            className="rounded border px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            초기화
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !canSubmit}
            className="rounded bg-orange-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-orange-700 disabled:opacity-60"
          >
            {submitting ? '신청 중…' : '신청'}
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
          <p className="mt-0.5 text-[11px] text-slate-500">총 {items.length}건</p>
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
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                    아직 신청 내역이 없습니다.
                  </td>
                </tr>
              ) : (
                items.map((it) => (
                  <tr key={it.id} className="border-t border-slate-100">
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
                        {it.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
