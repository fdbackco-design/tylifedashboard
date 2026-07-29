'use client';

import LoadingButton from '@/components/ui/LoadingButton';
import SimpleAlertModal from '@/components/ui/SimpleAlertModal';
import { useEffect, useMemo, useState } from 'react';

type AlertModalState = {
  variant: 'success' | 'warning';
  title: string;
  message: string;
};

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

type PendingCandidate = {
  member_id: string;
  name: string | null;
  rank: string | null;
  phone: string | null;
  category: 'CUSTOMER' | 'MANAGER';
  already_mapped_user_profile_id: string | null;
};

type PendingAccount = {
  user_profile_id: string;
  login_code: string | null;
  display_name: string | null;
  pre_issued_name: string | null;
  pre_issued_phone: string | null;
  mapping_status: 'PENDING' | 'MANUAL_REVIEW';
  mapping_reason: string | null;
  created_at: string | null;
  candidates: PendingCandidate[];
};

type IssuedAccount = {
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
};

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

/**
 * 전화번호에서 자동 로그인 ID(8자리 숫자)를 도출한다.
 * - 핸드폰 번호의 앞 010(또는 011 등 식별번호) 을 제외한 마지막 8자리 사용
 * - 숫자만 추출 후 길이가 8 미만이면 null
 */
function loginCodeFromPhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length < 8) return null;
  return digits.slice(-8);
}

/** 선택된 대상의 전화번호 기반 8자리 코드. 전화번호가 없거나 짧으면 랜덤 8자리. */
function defaultLoginCodeFor(phone: string | null | undefined): string {
  return loginCodeFromPhone(phone) ?? randomDigits8();
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
  const [isLoadingIssuedList, setIsLoadingIssuedList] = useState(false);
  const [issuedListError, setIssuedListError] = useState<string | null>(null);

  const [alertModal, setAlertModal] = useState<AlertModalState | null>(null);

  // 비밀번호 초기화
  const [resetLoginId, setResetLoginId] = useState('');
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  // Auth 이메일·비밀번호 + profile login_code 동시 정정
  const [changeLoginUserId, setChangeLoginUserId] = useState('');
  const [changeLoginId, setChangeLoginId] = useState('');
  const [isChangingLoginId, setIsChangingLoginId] = useState(false);

  // 사전 계정 발급 모달
  const [preIssueOpen, setPreIssueOpen] = useState(false);
  const [preName, setPreName] = useState('');
  const [prePhone, setPrePhone] = useState('');
  const [preLoginCode, setPreLoginCode] = useState('');
  const [prePassword, setPrePassword] = useState('');
  const [preIsActive, setPreIsActive] = useState(true);
  const [isPreIssuing, setIsPreIssuing] = useState(false);

  // 매핑 대기/검토 섹션
  const [pendingAccounts, setPendingAccounts] = useState<PendingAccount[]>([]);
  const [isLoadingPending, setIsLoadingPending] = useState(false);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [selectedCandidateByProfile, setSelectedCandidateByProfile] = useState<Record<string, string>>({});
  const [busyProfileId, setBusyProfileId] = useState<string | null>(null);
  const [isReevaluating, setIsReevaluating] = useState(false);

  // 구글 시트 동기화
  type SheetSyncRow = {
    rowNumber: number;
    name: string;
    phone?: string;
    loginId: string;
    result: 'SUCCESS' | 'FAILED' | 'SKIPPED';
    reason?: string;
  };
  type SheetSyncSummary = {
    sheetName: string;
    totalRows: number;
    targetRows: number;
    successCount: number;
    failedCount: number;
    skippedCount: number;
    results: SheetSyncRow[];
  };
  const [isSheetSyncing, setIsSheetSyncing] = useState(false);
  const [sheetSyncResult, setSheetSyncResult] = useState<SheetSyncSummary | null>(null);
  const [sheetSyncError, setSheetSyncError] = useState<string | null>(null);
  const [sheetSyncOpen, setSheetSyncOpen] = useState(false);

  const [issuedAccounts, setIssuedAccounts] = useState<IssuedAccount[]>([]);
  const [issuedSearchInput, setIssuedSearchInput] = useState('');
  const [issuedSearch, setIssuedSearch] = useState('');
  const [issuedPage, setIssuedPage] = useState(1);
  const [issuedTotal, setIssuedTotal] = useState(0);
  const [issuedTotalPages, setIssuedTotalPages] = useState(1);

  const normalizedQuery = useMemo(() => query.trim(), [query]);
  const emailDomain = 'tylifedashboard.local';

  function showAlert(variant: AlertModalState['variant'], title: string, message: string) {
    setAlertModal({ variant, title, message });
  }

  async function resetPasswordToLoginCode() {
    const raw = resetLoginId.trim();
    if (!raw) {
      showAlert('warning', '입력 확인', '로그인 ID(8자리)를 입력해 주세요.');
      return;
    }
    const digits =
      digitsFromLoginCode(raw.includes('@') ? raw : `${raw}@${emailDomain}`) ??
      raw.replace(/\D/g, '');
    if (!/^\d{8}$/.test(digits)) {
      showAlert('warning', '입력 확인', '로그인 ID는 8자리 숫자여야 합니다. (예: 26984730)');
      return;
    }
    if (!confirm(`로그인 ID ${digits} 의 비밀번호를 ${digits} 으로 초기화할까요?`)) return;

    setIsResettingPassword(true);
    try {
      const res = await fetch('/api/admin/account-issue/reset-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login_id: digits }),
      });
      const json = (await res.json()) as ApiResult<{
        login_code: string;
        display_name: string | null;
        email: string;
        password_hint: string;
      }>;
      if (!res.ok || !json.success) {
        showAlert('warning', '초기화 실패', json.success ? '초기화 실패' : json.error);
        return;
      }
      showAlert(
        'success',
        '비밀번호 초기화 완료',
        `${json.data.display_name ?? '-'} (${json.data.email})\n비밀번호: ${json.data.password_hint}\n다음 로그인 시 비밀번호 변경을 안내합니다.`,
      );
      setResetLoginId('');
    } catch (e) {
      showAlert('warning', '초기화 실패', e instanceof Error ? e.message : String(e));
    } finally {
      setIsResettingPassword(false);
    }
  }

  async function changeAccountLoginId() {
    const userId = changeLoginUserId.trim();
    const newLoginId = changeLoginId.replace(/\D/g, '');
    if (!/^[0-9a-f-]{36}$/i.test(userId)) {
      showAlert('warning', '입력 확인', 'Supabase Auth 사용자 UUID를 입력해 주세요.');
      return;
    }
    if (!/^\d{8}$/.test(newLoginId)) {
      showAlert('warning', '입력 확인', '새 로그인 ID는 8자리 숫자여야 합니다.');
      return;
    }
    if (
      !confirm(
        `사용자 ${userId}의 로그인 ID와 초기 비밀번호를 ${newLoginId}로 함께 변경할까요?`,
      )
    ) {
      return;
    }

    setIsChangingLoginId(true);
    try {
      const res = await fetch('/api/admin/account-issue/change-login-id', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, new_login_id: newLoginId }),
      });
      const json = (await res.json()) as ApiResult<{
        previous_login_id: string;
        login_id: string;
        email: string;
        password_hint: string;
      }>;
      if (!res.ok || !json.success) {
        showAlert('warning', '로그인 ID 정정 실패', json.success ? '정정 실패' : json.error);
        return;
      }
      showAlert(
        'success',
        '로그인 ID 정정 완료',
        `이메일: ${json.data.email}\n초기 비밀번호: ${json.data.password_hint}`,
      );
      setChangeLoginUserId('');
      setChangeLoginId('');
      void loadIssuedAccounts();
    } catch (e) {
      showAlert('warning', '로그인 ID 정정 실패', e instanceof Error ? e.message : String(e));
    } finally {
      setIsChangingLoginId(false);
    }
  }

  async function loadExistingProfile(memberId: string, phoneOverride?: string | null) {
    if (!memberId) return;
    // setSelectedCustomer 가 호출된 직후엔 state 가 아직 반영 전이므로,
    // 호출자가 phone 을 직접 넘겨주면 그것을 우선 사용한다.
    const phoneForCode =
      phoneOverride !== undefined ? phoneOverride : (selectedCustomer?.phone ?? null);
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
        const code = defaultLoginCodeFor(phoneForCode);
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
      const code = defaultLoginCodeFor(phoneForCode);
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
      if (res.status === 401) {
        throw new Error('관리자 로그인이 필요합니다. /admin/login 에서 다시 로그인해 주세요.');
      }
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
    await loadExistingProfile(c.id, c.phone ?? null);
  }

  async function issueAccount() {
    if (!selectedCustomer) return;
    if (!selectedMemberId) return;
    if (!loginCode.trim() || !password) {
      showAlert('warning', '입력 확인', '로그인 ID와 비밀번호를 입력하거나 자동 생성해 주세요.');
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
          showAlert(
            'success',
            existed ? '계정 반영 완료' : '계정 발급 완료',
            existed
              ? `이미 발급된 계정입니다. 상태만 반영했습니다.\n사용자 ID: ${json.data.user_id}`
              : `계정이 발급되었습니다.\n사용자 ID: ${json.data.user_id}`,
          );
          void loadIssuedAccounts();
          return;
        }

        lastError = json.success ? '발급 실패' : json.error;
        if (res.status === 409 && isDigitsOnly) {
          digitsToTry = randomDigits8();
          continue;
        }

        showAlert('warning', '발급 실패', lastError ?? '발급에 실패했습니다.');
        return;
      }

      showAlert('warning', '발급 실패', lastError ?? '발급 실패(중복 코드 재시도 초과)');
    } finally {
      setIsIssuing(false);
    }
  }

  function openPreIssueModal() {
    setPreName(normalizedQuery && !customers.length ? normalizedQuery : '');
    setPrePhone('');
    const code = randomDigits8();
    setPreLoginCode(code);
    setPrePassword(code);
    setPreIsActive(true);
    setPreIssueOpen(true);
  }

  async function submitPreIssue() {
    const name = preName.trim();
    if (!name) {
      showAlert('warning', '입력 확인', '이름을 입력해 주세요.');
      return;
    }
    const loginCodeOnly = preLoginCode.replace(/\D/g, '');
    const passwordOnly = prePassword.replace(/\D/g, '');
    if (loginCodeOnly.length !== 8) {
      showAlert('warning', '입력 확인', '로그인 ID는 8자리 숫자여야 합니다.');
      return;
    }
    if (passwordOnly !== loginCodeOnly) {
      showAlert('warning', '입력 확인', '초기 비밀번호는 로그인 ID와 동일한 8자리 숫자여야 합니다.');
      return;
    }

    setIsPreIssuing(true);
    try {
      // 동일 login_code 중복 시 재시도(최대 5회)
      let codeToTry = loginCodeOnly;
      for (let i = 0; i < 5; i++) {
        const res = await fetch('/api/admin/account-issue/pre-issue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            phone: prePhone.trim() || null,
            login_code: codeToTry,
            password: codeToTry,
            is_active: preIsActive,
          }),
          credentials: 'include',
        });
        const json = (await res.json()) as ApiResult<{ user_id: string; mapping_status: string }>;
        if (res.ok && json.success) {
          showAlert(
            'success',
            '사전 계정 발급 완료',
            `계정이 생성되었습니다. (로그인 ID: ${codeToTry})\n매핑 상태: ${json.data.mapping_status}\n\nTY 동기화 후 자동 매핑되거나, 매핑 검토 섹션에서 수동 매핑할 수 있습니다.`,
          );
          setPreIssueOpen(false);
          void loadIssuedAccounts();
          void loadPendingAccounts();
          return;
        }
        if (res.status === 409) {
          codeToTry = randomDigits8();
          continue;
        }
        showAlert('warning', '발급 실패', json.success ? '발급 실패' : json.error);
        return;
      }
      showAlert('warning', '발급 실패', '동일한 로그인 ID 가 반복 발생합니다. 잠시 후 다시 시도해 주세요.');
    } catch (e) {
      showAlert('warning', '발급 실패', e instanceof Error ? e.message : String(e));
    } finally {
      setIsPreIssuing(false);
    }
  }

  async function loadPendingAccounts() {
    setIsLoadingPending(true);
    setPendingError(null);
    try {
      const res = await fetch('/api/admin/account-issue/pending', { credentials: 'include' });
      const json = (await res.json()) as ApiResult<PendingAccount[]>;
      if (res.status === 401) {
        setPendingError('관리자 세션이 없습니다.');
        setPendingAccounts([]);
        return;
      }
      if (!res.ok || !json.success) throw new Error(json.success ? 'error' : json.error);
      setPendingAccounts(json.data);
      // 디폴트 후보 선택: 첫 번째(이미 매핑된 후보는 제외) 가능하면 그 값
      setSelectedCandidateByProfile((prev) => {
        const next = { ...prev };
        for (const row of json.data) {
          if (next[row.user_profile_id]) continue;
          const first = row.candidates.find((c) => !c.already_mapped_user_profile_id);
          if (first) next[row.user_profile_id] = first.member_id;
        }
        return next;
      });
    } catch (e) {
      setPendingError(e instanceof Error ? e.message : '목록을 불러오지 못했습니다.');
      setPendingAccounts([]);
    } finally {
      setIsLoadingPending(false);
    }
  }

  async function reevaluateAutoMapping() {
    setIsReevaluating(true);
    try {
      const res = await fetch('/api/admin/account-issue/reevaluate', {
        method: 'POST',
        credentials: 'include',
      });
      const json = (await res.json()) as ApiResult<{
        matched_count: number;
        manual_review_count: number;
        pending_count: number;
        scanned_count: number;
      }>;
      if (!res.ok || !json.success) throw new Error(json.success ? 'error' : json.error);
      showAlert(
        'success',
        '재평가 완료',
        `평가 ${json.data.scanned_count}건 → 자동 매핑 ${json.data.matched_count}건 / 검토 필요 ${json.data.manual_review_count}건 / 대기 유지 ${json.data.pending_count}건`,
      );
      await loadPendingAccounts();
      await loadIssuedAccounts();
    } catch (e) {
      showAlert('warning', '재평가 실패', e instanceof Error ? e.message : String(e));
    } finally {
      setIsReevaluating(false);
    }
  }

  async function manualMap(profileId: string) {
    const memberId = selectedCandidateByProfile[profileId];
    if (!memberId) {
      showAlert('warning', '입력 확인', '매핑할 후보 사람을 먼저 선택해 주세요.');
      return;
    }
    setBusyProfileId(profileId);
    try {
      const res = await fetch('/api/admin/account-issue/manual-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'map', user_profile_id: profileId, member_id: memberId }),
        credentials: 'include',
      });
      const json = (await res.json()) as ApiResult<{ mapping_status: string }>;
      if (!res.ok || !json.success) {
        showAlert('warning', '매핑 실패', json.success ? '매핑 실패' : json.error);
        return;
      }
      showAlert('success', '매핑 완료', '계정이 사람 데이터와 매핑되었습니다.');
      await loadPendingAccounts();
      await loadIssuedAccounts();
    } finally {
      setBusyProfileId(null);
    }
  }

  async function unmapProfile(profileId: string) {
    setBusyProfileId(profileId);
    try {
      const res = await fetch('/api/admin/account-issue/manual-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unmap', user_profile_id: profileId }),
        credentials: 'include',
      });
      const json = (await res.json()) as ApiResult<{ mapping_status: string }>;
      if (!res.ok || !json.success) {
        showAlert('warning', '해제 실패', json.success ? '해제 실패' : json.error);
        return;
      }
      showAlert('success', '매핑 해제 완료', '계정이 사람 데이터와의 매핑에서 해제되었습니다.');
      await loadPendingAccounts();
      await loadIssuedAccounts();
    } finally {
      setBusyProfileId(null);
    }
  }

  async function runGoogleSheetSync() {
    setIsSheetSyncing(true);
    setSheetSyncError(null);
    setSheetSyncResult(null);
    setSheetSyncOpen(true);
    try {
      const res = await fetch('/api/admin/account-issue/sync-sheet', {
        method: 'POST',
        credentials: 'include',
      });
      const json = (await res.json()) as ApiResult<SheetSyncSummary>;
      if (!res.ok || !json.success) {
        setSheetSyncError(json.success ? '동기화 실패' : json.error);
        return;
      }
      setSheetSyncResult(json.data);
      void loadIssuedAccounts();
      void loadPendingAccounts();
    } catch (e) {
      setSheetSyncError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsSheetSyncing(false);
    }
  }

  async function loadIssuedAccounts(options?: { page?: number; search?: string }) {
    const nextPage = options?.page ?? issuedPage;
    const nextSearch = options?.search ?? issuedSearch;
    setIsLoadingIssuedList(true);
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        page_size: '20',
      });
      if (nextSearch) params.set('search', nextSearch);
      const res = await fetch(`/api/admin/account-issue/list?${params.toString()}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const json = (await res.json()) as ApiResult<
        {
          items: IssuedAccount[];
          pagination: {
            page: number;
            page_size: number;
            total: number;
            total_pages: number;
          };
        }
      >;
      if (res.status === 401) {
        setIssuedListError('관리자 세션이 없습니다. /admin/login 에서 다시 로그인하거나, PWA 사용 시 사이트 데이터를 비운 뒤 새로고침해 보세요.');
        setIssuedAccounts([]);
        setIssuedTotal(0);
        return;
      }
      if (!res.ok || !json.success) throw new Error(json.success ? 'error' : json.error);
      setIssuedAccounts(json.data.items);
      setIssuedPage(json.data.pagination.page);
      setIssuedTotal(json.data.pagination.total);
      setIssuedTotalPages(json.data.pagination.total_pages);
      setIssuedListError(null);
    } catch (e) {
      setIssuedListError(e instanceof Error ? e.message : '목록을 불러오지 못했습니다.');
      setIssuedAccounts([]);
      setIssuedTotal(0);
    } finally {
      setIsLoadingIssuedList(false);
    }
  }

  useEffect(() => {
    loadIssuedAccounts();
    loadPendingAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <SimpleAlertModal
        open={alertModal !== null}
        variant={alertModal?.variant ?? 'success'}
        title={alertModal?.title ?? ''}
        message={alertModal?.message ?? ''}
        onClose={() => setAlertModal(null)}
      />

      {/* 구글 시트 동기화 결과 모달 */}
      {sheetSyncOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-3xl rounded-xl bg-white p-5 shadow-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <div className="text-base font-semibold text-gray-900">구글 시트 동기화 결과</div>
              <button
                type="button"
                onClick={() => setSheetSyncOpen(false)}
                disabled={isSheetSyncing}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none disabled:opacity-50"
                aria-label="닫기"
              >
                ×
              </button>
            </div>

            {isSheetSyncing ? (
              <div className="py-10 text-center text-sm text-gray-600">
                Google Sheets &lsquo;시트1&rsquo; 을 동기화하는 중입니다. 잠시만 기다려 주세요…
              </div>
            ) : sheetSyncError ? (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                <div className="font-semibold mb-1">동기화 중 오류가 발생했습니다.</div>
                <div className="text-xs break-all">{sheetSyncError}</div>
              </div>
            ) : sheetSyncResult ? (
              <div className="space-y-4 overflow-auto">
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-2">
                    <div className="text-[11px] text-slate-500">총 조회</div>
                    <div className="text-lg font-bold tabular-nums">{sheetSyncResult.totalRows.toLocaleString('ko-KR')}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-2">
                    <div className="text-[11px] text-slate-500">처리 대상</div>
                    <div className="text-lg font-bold tabular-nums">{sheetSyncResult.targetRows.toLocaleString('ko-KR')}</div>
                  </div>
                  <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2">
                    <div className="text-[11px] text-emerald-700">발급 성공</div>
                    <div className="text-lg font-bold tabular-nums text-emerald-700">
                      {sheetSyncResult.successCount.toLocaleString('ko-KR')}
                    </div>
                  </div>
                  <div className="rounded-lg bg-red-50 border border-red-200 p-2">
                    <div className="text-[11px] text-red-700">실패</div>
                    <div className="text-lg font-bold tabular-nums text-red-700">
                      {sheetSyncResult.failedCount.toLocaleString('ko-KR')}
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-2">
                    <div className="text-[11px] text-slate-500">스킵</div>
                    <div className="text-lg font-bold tabular-nums">{sheetSyncResult.skippedCount.toLocaleString('ko-KR')}</div>
                  </div>
                </div>

                {sheetSyncResult.results.filter((r) => r.result === 'FAILED').length > 0 ? (
                  <div>
                    <div className="text-sm font-semibold text-gray-700 mb-2">실패 목록</div>
                    <div className="overflow-x-auto rounded-lg border border-gray-200">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50">
                          <tr className="text-left text-[11px] text-gray-600">
                            {['행', '이름', '전화번호', '로그인 ID', '사유'].map((h) => (
                              <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sheetSyncResult.results
                            .filter((r) => r.result === 'FAILED')
                            .map((r) => (
                              <tr key={r.rowNumber} className="border-t border-gray-100">
                                <td className="px-3 py-2 tabular-nums">{r.rowNumber}</td>
                                <td className="px-3 py-2 whitespace-nowrap">{r.name || '-'}</td>
                                <td className="px-3 py-2 whitespace-nowrap">{r.phone ?? '-'}</td>
                                <td className="px-3 py-2 whitespace-nowrap font-mono">{r.loginId || '-'}</td>
                                <td className="px-3 py-2 text-red-700">{r.reason ?? '-'}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                {sheetSyncResult.results.filter((r) => r.result === 'SUCCESS').length > 0 ? (
                  <div>
                    <div className="text-sm font-semibold text-gray-700 mb-2">성공 목록</div>
                    <div className="overflow-x-auto rounded-lg border border-emerald-100">
                      <table className="w-full text-xs">
                        <thead className="bg-emerald-50">
                          <tr className="text-left text-[11px] text-emerald-800">
                            {['행', '이름', '전화번호', '로그인 ID'].map((h) => (
                              <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sheetSyncResult.results
                            .filter((r) => r.result === 'SUCCESS')
                            .map((r) => (
                              <tr key={r.rowNumber} className="border-t border-emerald-50">
                                <td className="px-3 py-2 tabular-nums">{r.rowNumber}</td>
                                <td className="px-3 py-2 whitespace-nowrap">{r.name || '-'}</td>
                                <td className="px-3 py-2 whitespace-nowrap">{r.phone ?? '-'}</td>
                                <td className="px-3 py-2 whitespace-nowrap font-mono">{r.loginId || '-'}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSheetSyncOpen(false)}
                disabled={isSheetSyncing}
                className="px-3 py-1.5 rounded-md border border-gray-300 text-sm text-gray-700 disabled:opacity-50"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 사전 계정 발급 모달 */}
      {preIssueOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <div className="text-base font-semibold text-gray-900">사전 계정 발급</div>
              <button
                type="button"
                onClick={() => setPreIssueOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
                aria-label="닫기"
              >
                ×
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              아직 계약/TY 동기화 데이터가 없는 사람에게 미리 계정을 발급합니다. 이후 TY 동기화로 동일 이름의 사람이
              들어오면 자동 매핑되며, 불확실한 경우엔 검토 대상으로 분류됩니다.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">이름 *</label>
                <input
                  value={preName}
                  onChange={(e) => setPreName(e.target.value)}
                  placeholder="예: 홍길동"
                  className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">전화번호</label>
                <input
                  value={prePhone}
                  onChange={(e) => setPrePhone(e.target.value)}
                  placeholder="010-1234-5678"
                  className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  고객명 기준 자동 매핑은 전화번호가 동일해야 적용됩니다(미입력 시 후보가 있어도 수동 검토 대상).
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700">로그인 ID(8자리 숫자) *</label>
                  <input
                    value={preLoginCode}
                    onChange={(e) => setPreLoginCode(e.target.value)}
                    placeholder="12345678"
                    className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    className="mt-1 text-xs text-blue-600 hover:underline"
                    onClick={() => {
                      const code = randomDigits8();
                      setPreLoginCode(code);
                      setPrePassword(code);
                    }}
                  >
                    자동 생성
                  </button>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">초기 비밀번호 *</label>
                  <input
                    value={prePassword}
                    onChange={(e) => setPrePassword(e.target.value)}
                    placeholder="12345678"
                    className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="pre_is_active"
                  type="checkbox"
                  checked={preIsActive}
                  onChange={(e) => setPreIsActive(e.target.checked)}
                />
                <label htmlFor="pre_is_active" className="text-sm text-gray-700">
                  계정 활성
                </label>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPreIssueOpen(false)}
                disabled={isPreIssuing}
                className="px-3 py-1.5 rounded-md border border-gray-300 text-sm text-gray-700 disabled:opacity-50"
              >
                취소
              </button>
              <LoadingButton
                type="button"
                isLoading={isPreIssuing}
                loadingText="발급 중…"
                onClick={() => void submitPreIssue()}
                className="px-3 py-1.5 rounded-md bg-amber-600 text-white text-sm font-semibold disabled:opacity-50"
              >
                사전 발급
              </LoadingButton>
            </div>
          </div>
        </div>
      ) : null}

    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="text-sm font-semibold text-gray-700">계정 발급</div>
          <LoadingButton
            type="button"
            isLoading={isSheetSyncing}
            loadingText="동기화 중…"
            onClick={() => void runGoogleSheetSync()}
            className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
            title="Google Sheets '시트1' 의 미처리 행을 읽어 자동으로 계정을 발급합니다."
          >
            구글 시트 동기화
          </LoadingButton>
        </div>
        <div className="flex gap-2 items-end flex-wrap">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-sm font-medium text-gray-700">이름 또는 휴대폰번호</label>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="예: 홍길동 / 010-1234-5678"
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
        <div className="text-sm font-semibold text-gray-700 mb-1">비밀번호 초기화</div>
        <p className="text-xs text-gray-500 mb-3">
          로그인 ID(8자리)를 입력하면 비밀번호를 동일한 8자리로 초기화합니다.
          (@tylifedashboard.local 계정은 이메일 재설정이 불가해 Admin API로 처리합니다.)
        </p>
        <div className="flex gap-2 items-end flex-wrap">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-sm font-medium text-gray-700">로그인 ID</label>
            <input
              value={resetLoginId}
              onChange={(e) => setResetLoginId(e.target.value)}
              placeholder="예: 26984730"
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                void resetPasswordToLoginCode();
              }}
              className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono"
              disabled={isResettingPassword}
            />
          </div>
          <LoadingButton
            type="button"
            isLoading={isResettingPassword}
            loadingText="초기화 중…"
            disabled={!resetLoginId.trim()}
            onClick={() => void resetPasswordToLoginCode()}
            className="px-4 py-2 rounded-md bg-rose-700 text-white text-sm font-semibold hover:bg-rose-800 disabled:opacity-50"
          >
            비밀번호 초기화
          </LoadingButton>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="text-sm font-semibold text-gray-700 mb-1">로그인 ID 정정</div>
        <p className="text-xs text-gray-500 mb-3">
          Auth 이메일·초기 비밀번호와 user_profiles의 login_code를 새 8자리 ID로 함께 변경합니다.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-[minmax(260px,1fr)_minmax(180px,0.5fr)_auto] gap-2 items-end">
          <div>
            <label className="block text-sm font-medium text-gray-700">사용자 UUID</label>
            <input
              value={changeLoginUserId}
              onChange={(e) => setChangeLoginUserId(e.target.value)}
              placeholder="f14bb25a-7d80-4d41-a8e7-0d5357d35ecd"
              className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono"
              disabled={isChangingLoginId}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">새 로그인 ID</label>
            <input
              value={changeLoginId}
              onChange={(e) => setChangeLoginId(e.target.value)}
              placeholder="26859589"
              inputMode="numeric"
              maxLength={8}
              className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono"
              disabled={isChangingLoginId}
            />
          </div>
          <LoadingButton
            type="button"
            isLoading={isChangingLoginId}
            loadingText="정정 중…"
            disabled={!changeLoginUserId.trim() || !changeLoginId.trim()}
            onClick={() => void changeAccountLoginId()}
            className="px-4 py-2 rounded-md bg-indigo-700 text-white text-sm font-semibold hover:bg-indigo-800 disabled:opacity-50"
          >
            로그인 ID 정정
          </LoadingButton>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="text-sm font-semibold text-gray-700">검색 결과</div>
          <button
            type="button"
            onClick={openPreIssueModal}
            className="px-3 py-1.5 rounded-md bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700"
            title="계약/TY 동기화 데이터가 아직 없는 사람에게도 미리 계정을 발급합니다. 이후 동기화 시 자동 매핑됩니다."
          >
            사전 계정 발급
          </button>
        </div>
        {customers.length === 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-gray-500">결과가 없습니다.</p>
            <p className="text-xs text-gray-500">
              해당하는 사람을 찾지 못하셨다면 우측 상단의 <span className="font-semibold text-amber-700">사전 계정 발급</span> 버튼으로 미리 계정을 만들 수 있습니다.
            </p>
          </div>
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
                  // 선택된 대상의 전화번호 마지막 8자리(010 제외) → 없으면 랜덤
                  const code = defaultLoginCodeFor(selectedCustomer?.phone);
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
                  const code = defaultLoginCodeFor(selectedCustomer?.phone);
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

      {/* 매핑 대기/검토 */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3 gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-700">매핑 대기 / 검토 필요</div>
            <div className="text-xs text-gray-500 mt-0.5">
              사전 발급 계정 중 사람 데이터와 아직 연결되지 않았거나 자동 매핑이 불확실한 항목입니다.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LoadingButton
              type="button"
              isLoading={isReevaluating}
              loadingText="재평가 중…"
              onClick={() => void reevaluateAutoMapping()}
              className="px-3 py-1.5 rounded-md bg-slate-800 text-white text-xs font-semibold hover:bg-slate-900 disabled:opacity-50"
            >
              자동 매핑 재평가
            </LoadingButton>
            <LoadingButton
              type="button"
              isLoading={isLoadingPending}
              loadingText="불러오는 중…"
              onClick={() => void loadPendingAccounts()}
              className="px-3 py-1.5 rounded-md border border-gray-300 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              새로고침
            </LoadingButton>
          </div>
        </div>
        {pendingError ? (
          <p className="text-sm text-red-600">{pendingError}</p>
        ) : pendingAccounts.length === 0 ? (
          <p className="text-sm text-gray-500">매핑 대기 중인 사전 발급 계정이 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {pendingAccounts.map((row) => {
              const selectedMember = selectedCandidateByProfile[row.user_profile_id] ?? '';
              const selectedCand = row.candidates.find((c) => c.member_id === selectedMember) ?? null;
              const disabledBecauseMapped = !!selectedCand?.already_mapped_user_profile_id;
              return (
                <div
                  key={row.user_profile_id}
                  className={`rounded-lg border p-3 ${
                    row.mapping_status === 'MANUAL_REVIEW'
                      ? 'border-amber-300 bg-amber-50/40'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm">
                      <span className="font-semibold text-gray-900">
                        {(row.pre_issued_name ?? row.display_name ?? '-').toString().replace(/^\[고객\]\s*/, '')}
                      </span>
                      <span className="ml-2 text-gray-600">{row.pre_issued_phone ?? '-'}</span>
                      <span className="ml-2 font-mono text-xs text-gray-500">
                        login_code: {row.login_code ?? '-'}
                      </span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-semibold ${
                        row.mapping_status === 'MANUAL_REVIEW'
                          ? 'bg-amber-200 text-amber-900'
                          : 'bg-slate-200 text-slate-800'
                      }`}
                    >
                      {row.mapping_status}
                    </span>
                  </div>
                  {row.mapping_reason ? (
                    <div className="mt-1 text-xs text-gray-500">사유: {row.mapping_reason}</div>
                  ) : null}

                  <div className="mt-3">
                    {row.candidates.length === 0 ? (
                      <p className="text-xs text-gray-500">
                        일치하는 후보 사람이 아직 없습니다. TY 동기화 후 자동으로 재평가됩니다.
                      </p>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={selectedMember}
                          disabled={busyProfileId === row.user_profile_id}
                          onChange={(e) =>
                            setSelectedCandidateByProfile((prev) => ({
                              ...prev,
                              [row.user_profile_id]: e.target.value,
                            }))
                          }
                          className="border border-gray-300 rounded-md px-2 py-1.5 text-sm min-w-[260px]"
                        >
                          <option value="">후보 선택…</option>
                          {row.candidates.map((c) => (
                            <option key={c.member_id} value={c.member_id}>
                              [{c.category === 'CUSTOMER' ? '고객' : '담당자'}] {c.name ?? '-'} ({c.rank ?? '-'}) · {c.phone ?? '-'}
                              {c.already_mapped_user_profile_id ? ' · 이미 매핑됨' : ''}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={
                            !selectedMember ||
                            disabledBecauseMapped ||
                            busyProfileId === row.user_profile_id
                          }
                          onClick={() => void manualMap(row.user_profile_id)}
                          className="px-3 py-1.5 rounded-md bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50"
                        >
                          {busyProfileId === row.user_profile_id ? '처리중…' : '수동 매핑'}
                        </button>
                        <button
                          type="button"
                          disabled={busyProfileId === row.user_profile_id}
                          onClick={() => void unmapProfile(row.user_profile_id)}
                          className="px-3 py-1.5 rounded-md border border-gray-300 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          title="매핑 해제 후 PENDING 상태로 되돌립니다."
                        >
                          매핑 해제
                        </button>
                        {disabledBecauseMapped ? (
                          <span className="text-xs text-red-600">선택한 후보는 이미 다른 계정에 매핑되어 있습니다.</span>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 생성된 계정 목록 */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex flex-wrap items-start justify-between mb-3 gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-700">생성된 계정</div>
            <div className="text-xs text-gray-500 mt-0.5">
              최근 순 · 총 {issuedTotal.toLocaleString('ko-KR')}개
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <form
              className="flex items-center gap-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                const search = issuedSearchInput.trim();
                setIssuedSearch(search);
                setIssuedPage(1);
                void loadIssuedAccounts({ page: 1, search });
              }}
            >
              <input
                type="search"
                value={issuedSearchInput}
                onChange={(event) => setIssuedSearchInput(event.target.value)}
                placeholder="이름·연락처·계정 검색"
                className="w-56 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
                disabled={isLoadingIssuedList}
              />
              <button
                type="submit"
                className="rounded-md bg-slate-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-600 disabled:opacity-50"
                disabled={isLoadingIssuedList}
              >
                검색
              </button>
              {issuedSearch && (
                <button
                  type="button"
                  className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  disabled={isLoadingIssuedList}
                  onClick={() => {
                    setIssuedSearchInput('');
                    setIssuedSearch('');
                    setIssuedPage(1);
                    void loadIssuedAccounts({ page: 1, search: '' });
                  }}
                >
                  초기화
                </button>
              )}
            </form>
            <LoadingButton
              type="button"
              className="px-3 py-1.5 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              isLoading={isLoadingIssuedList}
              loadingText="불러오는 중…"
              onClick={() => void loadIssuedAccounts()}
            >
              새로고침
            </LoadingButton>
          </div>
        </div>
        {issuedListError ? (
          <p className="text-sm text-red-600">{issuedListError}</p>
        ) : issuedAccounts.length === 0 ? (
          <p className="text-sm text-gray-500">생성된 계정이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-gray-200 rounded-lg">
              <thead className="bg-gray-50">
                <tr className="text-left text-xs text-gray-600">
                  {['이름', '연락처', '계정(login_code)', '활성', '생성일'].map((h) => (
                    <th key={h} className="px-3 py-2 border-b border-gray-200 font-semibold whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {issuedAccounts.map((a) => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 border-b border-gray-200 whitespace-nowrap">
                      {(a.display_name ?? '-').replace(/^\[고객\]\s*/, '')}
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
        {!issuedListError && issuedTotal > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600">
            <span>
              {issuedPage.toLocaleString('ko-KR')} / {issuedTotalPages.toLocaleString('ko-KR')} 페이지
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="rounded border border-gray-300 px-2.5 py-1 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={isLoadingIssuedList || issuedPage <= 1}
                onClick={() => void loadIssuedAccounts({ page: 1 })}
              >
                처음
              </button>
              <button
                type="button"
                className="rounded border border-gray-300 px-2.5 py-1 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={isLoadingIssuedList || issuedPage <= 1}
                onClick={() => void loadIssuedAccounts({ page: issuedPage - 1 })}
              >
                이전
              </button>
              <button
                type="button"
                className="rounded border border-gray-300 px-2.5 py-1 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={isLoadingIssuedList || issuedPage >= issuedTotalPages}
                onClick={() => void loadIssuedAccounts({ page: issuedPage + 1 })}
              >
                다음
              </button>
              <button
                type="button"
                className="rounded border border-gray-300 px-2.5 py-1 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={isLoadingIssuedList || issuedPage >= issuedTotalPages}
                onClick={() => void loadIssuedAccounts({ page: issuedTotalPages })}
              >
                마지막
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
    </>
  );
}

