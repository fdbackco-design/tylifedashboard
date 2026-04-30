'use client';

import { useEffect, useMemo, useState } from 'react';

type CustomerRow = {
  id: string;
  name: string;
  phone: string | null;
  rank?: string | null;
  customer_id?: string | null;
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

function digitsFromLoginCode(loginCodeEmail: string | null | undefined): string | null {
  const v = String(loginCodeEmail ?? '').trim();
  if (!v) return null;
  const local = v.includes('@') ? v.split('@')[0] : v;
  if (/^\d{8}$/.test(local)) return local;
  return null;
}

export default function AccountIssueClient() {
  const [query, setQuery] = useState('');
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null);
  const selectedCustomerId = selectedCustomer?.customer_id ?? null;
  const [memberCandidates, setMemberCandidates] = useState<MemberCandidate[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');

  const [loginCode, setLoginCode] = useState('');
  const [password, setPassword] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [isIssuing, setIsIssuing] = useState(false);

  const [issuedAccounts, setIssuedAccounts] = useState<
    Array<{
      id: string;
      customer_id: string | null;
      member_id: string | null;
      login_code: string;
      display_name: string | null;
      phone: string | null;
      role: string;
      is_active: boolean;
      must_change_password: boolean;
      created_at: string;
    }>
  >([]);

  const normalizedQuery = useMemo(() => query.trim(), [query]);
  const emailDomain = 'tylifedashboard.local';

  async function loadExistingProfile(memberId: string) {
    if (!memberId) return;
    try {
      const res = await fetch(`/api/admin/account-issue/existing?member_id=${encodeURIComponent(memberId)}`, {
        credentials: 'include',
      });
      const json = (await res.json()) as ApiResult<
        | {
            id: string;
            login_code: string;
            is_active: boolean;
          }
        | null
      >;

      if (!res.ok || !json.success) throw new Error(json.success ? 'error' : json.error);

      const profile = json.data;
      if (!profile) {
        const code = randomDigits8();
        setLoginCode(code);
        setPassword(code);
        setIsActive(true);
        return;
      }

      const digits = digitsFromLoginCode(profile.login_code);
      // 기존 발급 규칙(login_code=digits@domain, password=digits)에 맞춰 화면에는 digits만 표시
      setLoginCode(digits ?? profile.login_code);
      setPassword(digits ?? '');
      setIsActive(profile.is_active);
    } catch {
      // 기존이든 신규든, 오류가 나면 최소한 신규 발급 동작이 가능하도록 자동 생성값 세팅
      const code = randomDigits8();
      setLoginCode(code);
      setPassword(code);
    }
  }

  async function searchCustomers() {
    if (!normalizedQuery) return;
    setIsSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(
        `/api/admin/account-issue/customers?query=${encodeURIComponent(normalizedQuery)}`,
        { credentials: 'include' },
      );
      // 이제 검색 결과는 organization_members 기반이다.
      // id=member_id, customer_id는 (있으면) source_customer_id/external_id(customer:...)로 채워진다.
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

  async function handleSelectCustomer(c: CustomerRow) {
    setSelectedCustomer(c);
    // 검색 결과가 organization_members 기반이므로, 선택 즉시 해당 멤버를 발급 대상으로 설정
    setMemberCandidates([{ id: c.id, name: c.name, rank: c.rank ?? '-', phone: c.phone ?? null }]);
    setSelectedMemberId(c.id);
    await loadExistingProfile(c.id);
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

    const loginCodeTrim = loginCode.trim();
    const isDigitsOnly = !loginCodeTrim.includes('@');
    // digits-only 케이스는 (요구사항대로) password도 digits-only와 동일하게 전송한다.
    // 다만 “중복(409)”이 뜬 경우에만 digits를 재생성하도록 한다(기존계정이면 UI가 바뀌지 않게).
    const maxRetries = isDigitsOnly ? 5 : 1;
    let digitsToTry = loginCodeTrim;
    let lastError: string | null = null;

    setIsIssuing(true);
    try {
      for (let i = 0; i < maxRetries; i++) {
        const passwordToTry = isDigitsOnly ? digitsToTry : password;
        const loginCodeToSend = isDigitsOnly ? digitsToTry : loginCodeTrim;

        const res = await fetch('/api/admin/account-issue/issue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_id: selectedCustomerId ?? null,
            member_id: selectedMemberId,
            login_code: loginCodeToSend,
            password: passwordToTry,
            is_active: isActive,
          }),
          credentials: 'include',
        });

        const json = (await res.json()) as ApiResult<{ user_id: string; existed?: boolean }>;
        if (res.ok && json.success) {
          // “409 때문에 코드 재생성된 경우(i>0)”에만 UI 갱신
          if (i > 0 && isDigitsOnly) {
            setLoginCode(digitsToTry);
            setPassword(digitsToTry);
          }
          const existed = json.data.existed === true;
          alert(
            existed
              ? `이미 발급된 계정입니다. 상태만 반영했습니다.\n사용자 ID: ${json.data.user_id}`
              : `계정 발급 완료\n사용자 ID: ${json.data.user_id}`,
          );
          void loadIssuedAccounts();
          return;
        }

        lastError = json.success ? '발급 실패' : json.error;
        if (res.status === 409 && isDigitsOnly) {
          digitsToTry = randomDigits8();
          continue;
        }

        alert(lastError ?? '발급 실패');
        return;
      }

      alert(lastError ?? '발급 실패(중복 코드 재시도 초과)');
    } finally {
      setIsIssuing(false);
    }
  }

  async function loadIssuedAccounts() {
    try {
      const res = await fetch('/api/admin/account-issue/list', { credentials: 'include' });
      const json = (await res.json()) as ApiResult<
        Array<{
          id: string;
          customer_id: string | null;
          member_id: string | null;
          login_code: string;
          display_name: string | null;
          phone: string | null;
          role: string;
          is_active: boolean;
          must_change_password: boolean;
          created_at: string;
        }>
      >;
      if (!res.ok || !json.success) throw new Error(json.success ? 'error' : json.error);
      setIssuedAccounts(json.data);
    } catch {
      // 로딩 실패해도 발급 UI는 유지
    }
  }

  useEffect(() => {
    loadIssuedAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                if (!normalizedQuery) return;
                searchCustomers();
              }}
              className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            disabled={isSearching || isIssuing || !normalizedQuery}
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
                disabled={isIssuing}
                onClick={() => handleSelectCustomer(c)}
                className={`w-full text-left px-3 py-2 rounded-md border disabled:opacity-50 disabled:cursor-not-allowed ${
                  selectedCustomer?.id === c.id ? 'border-slate-800 bg-slate-50' : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium text-gray-900">{c.name}</div>
                    <div className="text-xs text-gray-500">
                      {c.phone ?? '-'} ({normalizePhoneDigits(c.phone ?? '') || '-'})
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {c.rank ? `직급: ${c.rank}` : '직급: -'}
                      {c.customer_id ? ' · 고객(customer) 연결 있음' : ''}
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
            <span className="font-medium">{selectedCustomer.name}</span> · {selectedCustomer.phone ?? '-'} ·{' '}
            {selectedCustomer.rank ? `(${selectedCustomer.rank})` : '(직급 -)'}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">발급 대상 조직원</label>
            <select
              value={selectedMemberId}
              disabled={isIssuing}
              onChange={(e) => {
                const nextId = e.target.value;
                setSelectedMemberId(nextId);
                // 후보 변경 즉시 기존 계정 정보/신규 자동 생성값 반영
                loadExistingProfile(nextId);
              }}
              className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm disabled:opacity-50"
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
              disabled={isIssuing || !selectedMemberId || !loginCode || !password}
              onClick={issueAccount}
              className="px-4 py-2 rounded-md bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50 min-w-[140px]"
            >
              {isIssuing ? '처리중…' : '계정 발급/저장'}
            </button>
          </div>
        </div>
      ) : null}

      {/* 생성된 계정 목록 */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3 gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-700">생성된 계정</div>
            <div className="text-xs text-gray-500 mt-0.5">최근 순 · 최대 200개</div>
          </div>
          <button
            type="button"
            className="px-3 py-1.5 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
            onClick={loadIssuedAccounts}
          >
            새로고침
          </button>
        </div>
        {issuedAccounts.length === 0 ? (
          <p className="text-sm text-gray-500">생성된 계정이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-gray-200 rounded-lg">
              <thead className="bg-gray-50">
                <tr className="text-left text-xs text-gray-600">
                  {['ID', '이름', '연락처', '계정(login_code)', '활성', '생성일'].map((h) => (
                    <th key={h} className="px-3 py-2 border-b border-gray-200 font-semibold whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {issuedAccounts.slice(0, 200).map((a) => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 border-b border-gray-200 font-mono text-xs whitespace-nowrap">
                      {a.member_id ?? '-'}
                    </td>
                    <td className="px-3 py-2 border-b border-gray-200 whitespace-nowrap">
                      {a.display_name ?? '-'}
                    </td>
                    <td className="px-3 py-2 border-b border-gray-200 whitespace-nowrap">
                      {a.phone ?? '-'}
                    </td>
                    <td className="px-3 py-2 border-b border-gray-200 font-mono text-xs whitespace-nowrap">
                      {a.login_code}
                    </td>
                    <td className="px-3 py-2 border-b border-gray-200 whitespace-nowrap">
                      <span className={a.is_active ? 'text-emerald-700 font-semibold' : 'text-gray-500'}>
                        {a.is_active ? '활성' : '비활성'}
                      </span>
                    </td>
                    <td className="px-3 py-2 border-b border-gray-200 whitespace-nowrap text-xs text-gray-600">
                      {a.created_at ? new Date(a.created_at).toLocaleString('ko-KR') : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

