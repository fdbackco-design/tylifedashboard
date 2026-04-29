'use client';

import { useMemo, useState } from 'react';

type CustomerRow = {
  id: string;
  name: string;
  phone: string | null;
};

type MemberCandidate = {
  id: string;
  name: string;
  rank: string;
  phone: string | null;
  source_customer_id?: string | null;
  external_id?: string | null;
};

type ApiResult<T> = { success: true; data: T } | { success: false; error: string };

function normalizePhoneDigits(v: string): string {
  return v.replace(/\D/g, '');
}

function randomPassword(len = 12): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function randomDigits8(): string {
  // 8자리(앞자리가 0일 수도 있음) 숫자만 생성
  const n = Math.floor(Math.random() * 100_000_000);
  return String(n).padStart(8, '0');
}

export default function AccountIssueClient() {
  const [query, setQuery] = useState('');
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null);
  const [memberCandidates, setMemberCandidates] = useState<MemberCandidate[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');

  const [loginCode, setLoginCode] = useState('');
  const [password, setPassword] = useState('');
  const [isActive, setIsActive] = useState(true);

  const normalizedQuery = useMemo(() => query.trim(), [query]);
  const emailDomain = 'tylifedashboard.local';

  async function searchCustomers() {
    if (!normalizedQuery) return;
    setIsSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(
        `/api/admin/account-issue/customers?query=${encodeURIComponent(normalizedQuery)}`,
        { credentials: 'include' },
      );
      const json = (await res.json()) as ApiResult<CustomerRow[]>;
      if (!res.ok || !json.success) throw new Error('검색 실패');
      setCustomers(json.data);
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : String(e));
      setCustomers([]);
    } finally {
      setIsSearching(false);
    }
  }

  async function loadMemberCandidates(customerId: string) {
    const res = await fetch(
      `/api/admin/account-issue/member-candidates?customer_id=${encodeURIComponent(customerId)}`,
      { credentials: 'include' },
    );
    const json = (await res.json()) as ApiResult<MemberCandidate[]>;
    if (!res.ok || !json.success) throw new Error(json.success ? 'error' : json.error);

    setMemberCandidates(json.data);
    const first = json.data[0]?.id ?? '';
    setSelectedMemberId(first);
    // 자동 생성 요구사항:
    // - login_code: 무작위 8자리 숫자
    // - password: login_code와 동일한 값
    if (!loginCode || !password) {
      const code = randomDigits8();
      setLoginCode(code);
      setPassword(code);
    }
  }

  async function handleSelectCustomer(c: CustomerRow) {
    setSelectedCustomer(c);
    setMemberCandidates([]);
    setSelectedMemberId('');
    await loadMemberCandidates(c.id);
  }

  async function issueAccount() {
    if (!selectedCustomer) return;
    if (!selectedMemberId) return;
    if (!loginCode.trim() || !password) {
      alert('로그인 ID와 비밀번호를 입력/자동생성 해주세요.');
      return;
    }
    if (!password) {
      alert('비밀번호를 입력/자동생성 해주세요.');
      return;
    }

    const codeDigits = loginCode.trim();
    const shouldRetryForUniqueDigits = !codeDigits.includes('@') && password.trim() === codeDigits;

    const maxRetries = shouldRetryForUniqueDigits ? 5 : 1;
    let lastError: string | null = null;

    for (let i = 0; i < maxRetries; i++) {
      const codeToTry = shouldRetryForUniqueDigits ? randomDigits8() : codeDigits;
      const loginEmail = codeDigits.includes('@') ? codeDigits : `${codeToTry}@${emailDomain}`;
      const passwordToTry = shouldRetryForUniqueDigits ? codeToTry : password;

      const res = await fetch('/api/admin/account-issue/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: selectedCustomer.id,
          member_id: selectedMemberId,
          login_code: loginEmail,
          password: passwordToTry,
          is_active: isActive,
        }),
        credentials: 'include',
      });

      const json = (await res.json()) as ApiResult<{ user_id: string }>;
      if (res.ok && json.success) {
        // retry 성공 시 UI에도 반영
        if (shouldRetryForUniqueDigits) {
          setLoginCode(codeToTry);
          setPassword(codeToTry);
        }
        alert(`계정 발급 완료: ${json.data.user_id}`);
        return;
      }

      lastError = json.success ? '발급 실패' : json.error;
      if (res.status === 409 && shouldRetryForUniqueDigits) {
        continue; // 중복이면 code 재생성 후 재시도
      }

      alert(lastError ?? '발급 실패');
      return;
    }

    alert(lastError ?? '발급 실패(중복 코드 재시도 초과)');
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex gap-2 items-end flex-wrap">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-sm font-medium text-gray-700">이름 또는 휴대폰번호</label>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="예: 김세영 / 010-1234-5678"
              className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            disabled={isSearching || !normalizedQuery}
            onClick={searchCustomers}
            className="px-4 py-2 rounded-md bg-slate-800 text-white text-sm font-semibold disabled:opacity-50"
          >
            {isSearching ? '검색중...' : '검색'}
          </button>
        </div>

        {searchError ? <p className="mt-3 text-sm text-red-600">{searchError}</p> : null}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="text-sm font-semibold text-gray-700 mb-3">검색 결과</div>
        {customers.length === 0 ? (
          <p className="text-sm text-gray-500">결과가 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {customers.slice(0, 20).map((c) => (
              <button
                type="button"
                key={c.id}
                onClick={() => handleSelectCustomer(c)}
                className={`w-full text-left px-3 py-2 rounded-md border ${
                  selectedCustomer?.id === c.id ? 'border-slate-800 bg-slate-50' : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium text-gray-900">{c.name}</div>
                    <div className="text-xs text-gray-500">
                      {c.phone ?? '-'} ({normalizePhoneDigits(c.phone ?? '') || '-'})
                    </div>
                  </div>
                  <div className="text-xs text-gray-500">선택</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedCustomer ? (
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
          <div className="text-sm font-semibold text-gray-700">선택된 대상</div>
          <div className="text-sm text-gray-700">
            <span className="font-medium">{selectedCustomer.name}</span> · {selectedCustomer.phone ?? '-'}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">연결 가능한 조직원 후보</label>
            <select
              value={selectedMemberId}
              onChange={(e) => setSelectedMemberId(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            >
              {memberCandidates.length === 0 ? <option value="">후보 없음</option> : null}
              {memberCandidates.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.rank})
                </option>
              ))}
            </select>
            {memberCandidates.length > 0 && !selectedMemberId ? <p className="text-xs text-amber-700 mt-2">후보를 선택해주세요.</p> : null}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700">로그인 ID(8자리 숫자)</label>
              <input
                value={loginCode}
                onChange={(e) => setLoginCode(e.target.value)}
                placeholder="12345678"
                className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
              <button
                type="button"
                className="mt-2 text-xs text-blue-600 hover:underline"
                onClick={() => {
                  if (!selectedMemberId) return;
                  const code = randomDigits8();
                  setLoginCode(code);
                  setPassword(code);
                }}
              >
                자동 생성
              </button>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">초기 비밀번호(화면에 표시)</label>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="12345678"
                className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
              <button
                type="button"
                className="mt-2 text-xs text-blue-600 hover:underline"
                onClick={() => {
                  const code = randomDigits8();
                  setLoginCode(code);
                  setPassword(code);
                }}
              >
                자동 생성
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input
              id="is_active"
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <label htmlFor="is_active" className="text-sm text-gray-700">
              계정 활성
            </label>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={!selectedMemberId || !loginCode || !password}
              onClick={issueAccount}
              className="px-4 py-2 rounded-md bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50"
            >
              계정 발급/저장
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

