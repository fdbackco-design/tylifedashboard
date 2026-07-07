'use client';

import { useMemo, useState } from 'react';

type MemberRow = {
  id: string;
  name: string;
  rank: string;
  phone?: string | null;
  external_id?: string | null;
};

type Status = 'active' | 'paused' | 'ended';

type PendingAccountRow = {
  id: string;
  login_code: string;
  display_name: string | null;
  phone: string | null;
  mapping_status: 'PENDING' | 'MANUAL_REVIEW';
  pre_issued_name: string | null;
  pre_issued_phone: string | null;
  created_at: string;
};

type SettingRow = {
  id: string;
  member_id: string;
  parent_leader_member_id: string;
  reason: string;
  special_unit_price: number;
  special_unit_limit: number;
  effective_from: string;
  effective_to: string | null;
  status: Status;
  note: string | null;
  member_name: string;
  member_rank: string;
  parent_name: string;
  parent_rank: string;
};

function extractName(raw: string): string {
  return String(raw ?? '').replace(/^\[고객\]\s*/, '').trim();
}

function fmtWon(n: number): string {
  return `₩${Math.round(n).toLocaleString()}`;
}

function maskPhone(phone: string | null | undefined): string {
  const p = String(phone ?? '').trim();
  if (!p) return '-';
  // 01012341234 / 010-1234-1234 모두 대응
  const digits = p.replace(/\D/g, '');
  if (digits.length >= 11) {
    return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
  }
  if (p.includes('-')) {
    const parts = p.split('-');
    if (parts.length === 3) return `${parts[0]}-****-${parts[2]}`;
  }
  return p;
}

function MemberSearchPicker(props: {
  label: string;
  members: Array<{ id: string; name: string; rank: string; phone?: string | null }>;
  selectedId: string;
  onSelect: (id: string) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const selected = props.members.find((m) => m.id === props.selectedId) ?? null;
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return props.members
      .filter((m) => {
        const hay = `${m.name} ${m.rank} ${maskPhone(m.phone)}`.toLowerCase();
        return hay.includes(s);
      })
      .slice(0, 10);
  }, [q, props.members]);

  return (
    <div className="flex flex-col gap-1">
      <span className="font-semibold text-gray-700">{props.label}</span>
      {selected ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-gray-200 bg-white px-2 py-2">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-gray-800 whitespace-nowrap truncate">
              {selected.name}{' '}
              <span className="text-gray-500 font-medium">({selected.rank})</span>
              <span className="ml-2 text-[11px] text-gray-400">{maskPhone(selected.phone)}</span>
            </div>
            <div className="text-[11px] font-mono text-gray-400 truncate">{selected.id}</div>
          </div>
          <button
            type="button"
            onClick={() => props.onSelect('')}
            className="shrink-0 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
          >
            변경
          </button>
        </div>
      ) : (
        <>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={props.placeholder ?? '이름/직급/연락처로 검색…'}
            className="rounded-md border border-gray-200 px-2 py-2"
          />
          {results.length > 0 ? (
            <div className="max-h-48 overflow-auto rounded-md border border-gray-200 bg-white">
              {results.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    props.onSelect(m.id);
                    setQ('');
                  }}
                  className="w-full text-left px-2 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                >
                  <div className="text-xs font-semibold text-gray-800">
                    {m.name}{' '}
                    <span className="text-gray-500 font-medium">({m.rank})</span>
                    <span className="ml-2 text-[11px] text-gray-400">{maskPhone(m.phone)}</span>
                  </div>
                  <div className="text-[11px] font-mono text-gray-400">{m.id}</div>
                </button>
              ))}
            </div>
          ) : q.trim() ? (
            <div className="text-[11px] text-gray-500">검색 결과가 없습니다.</div>
          ) : null}
        </>
      )}
    </div>
  );
}

type SalesTargetOption =
  | { key: `member:${string}`; kind: 'member'; id: string; name: string; rank: string; phone?: string | null }
  | {
      key: `pending:${string}`;
      kind: 'pending';
      id: string; // user_profile_id
      name: string;
      rank: '미매핑';
      phone?: string | null;
      login_code: string;
      mapping_status: string;
    };

function SalesTargetSearchPicker(props: {
  label: string;
  memberOptions: Array<{ id: string; name: string; rank: string; phone?: string | null }>;
  pendingAccounts: PendingAccountRow[];
  selectedKey: string; // member:<uuid> | pending:<uuid> | ''
  onSelect: (opt: SalesTargetOption | null) => void;
}) {
  const [q, setQ] = useState('');

  const options = useMemo<SalesTargetOption[]>(() => {
    const members: SalesTargetOption[] = props.memberOptions.map((m) => ({
      key: `member:${m.id}`,
      kind: 'member',
      id: m.id,
      name: m.name,
      rank: m.rank,
      phone: m.phone ?? null,
    }));
    const pendings: SalesTargetOption[] = (props.pendingAccounts ?? []).map((p) => ({
      key: `pending:${p.id}`,
      kind: 'pending',
      id: p.id,
      name: extractName(p.pre_issued_name ?? p.display_name ?? '-') || '-',
      rank: '미매핑',
      phone: p.pre_issued_phone ?? p.phone ?? null,
      login_code: p.login_code,
      mapping_status: p.mapping_status,
    }));
    return [...members, ...pendings];
  }, [props.memberOptions, props.pendingAccounts]);

  const selected = useMemo(() => options.find((o) => o.key === props.selectedKey) ?? null, [options, props.selectedKey]);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return options
      .filter((o) => {
        const phone = maskPhone(o.phone);
        const extra = o.kind === 'pending' ? `${o.login_code} ${o.mapping_status}` : '';
        const hay = `${o.name} ${o.rank} ${phone} ${extra}`.toLowerCase();
        return hay.includes(s);
      })
      .slice(0, 12);
  }, [q, options]);

  return (
    <div className="flex flex-col gap-1">
      <span className="font-semibold text-gray-700">{props.label}</span>
      {selected ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-gray-200 bg-white px-2 py-2">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-gray-800 whitespace-nowrap truncate">
              {selected.name}{' '}
              <span className="text-gray-500 font-medium">
                ({selected.kind === 'pending' ? '미매핑 계정' : selected.rank})
              </span>
              <span className="ml-2 text-[11px] text-gray-400">{maskPhone(selected.phone)}</span>
              {selected.kind === 'pending' ? (
                <span className="ml-2 text-[11px] text-amber-700 font-semibold">
                  {selected.login_code} · {selected.mapping_status}
                </span>
              ) : null}
            </div>
            <div className="text-[11px] font-mono text-gray-400 truncate">{selected.kind === 'pending' ? `user_profile:${selected.id}` : selected.id}</div>
          </div>
          <button
            type="button"
            onClick={() => props.onSelect(null)}
            className="shrink-0 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
          >
            변경
          </button>
        </div>
      ) : (
        <>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름/직급/연락처/로그인코드로 검색…"
            className="rounded-md border border-gray-200 px-2 py-2"
          />
          {results.length > 0 ? (
            <div className="max-h-56 overflow-auto rounded-md border border-gray-200 bg-white">
              {results.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => {
                    props.onSelect(o);
                    setQ('');
                  }}
                  className="w-full text-left px-2 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                >
                  <div className="text-xs font-semibold text-gray-800">
                    {o.name}{' '}
                    <span className="text-gray-500 font-medium">
                      ({o.kind === 'pending' ? '미매핑 계정' : o.rank})
                    </span>
                    <span className="ml-2 text-[11px] text-gray-400">{maskPhone(o.phone)}</span>
                    {o.kind === 'pending' ? (
                      <span className="ml-2 text-[11px] text-amber-700 font-semibold">
                        {o.login_code} · {o.mapping_status}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-[11px] font-mono text-gray-400">
                    {o.kind === 'pending' ? `user_profile:${o.id}` : o.id}
                  </div>
                </button>
              ))}
            </div>
          ) : q.trim() ? (
            <div className="text-[11px] text-gray-500">검색 결과가 없습니다.</div>
          ) : null}
        </>
      )}
    </div>
  );
}

export default function PreIssuedCodeMembersClient(props: {
  members: MemberRow[];
  initialSettings: SettingRow[];
  pendingAccounts: PendingAccountRow[];
  pendingSettings: any[];
}) {
  const members = useMemo(
    () =>
      (props.members ?? []).map((m) => ({
        ...m,
        name: extractName(m.name),
      })),
    [props.members],
  );

  const [settings, setSettings] = useState<SettingRow[]>((props.initialSettings ?? []) as SettingRow[]);

  const [memberId, setMemberId] = useState('');
  const [parentId, setParentId] = useState('');
  const [reason, setReason] = useState('코드 선발급');
  const [unitPrice, setUnitPrice] = useState(100000);
  const [unitLimit, setUnitLimit] = useState(10);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [status, setStatus] = useState<Status>('active');
  const [note, setNote] = useState('');
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [history, setHistory] = useState<any[] | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [pendingEditing, setPendingEditing] = useState<PendingAccountRow | null>(null);
  const [salesTargetKey, setSalesTargetKey] = useState<string>(''); // member:<id> | pending:<id> | ''
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const memberOptions = members
    .filter((m) => (m.rank ?? '') !== '본사')
    .map((m) => ({
      id: m.id,
      name: m.name,
      rank: m.rank,
      phone: m.phone ?? null,
    }));

  function fillFromRow(r: SettingRow) {
    setEditingMemberId(r.member_id);
    setMemberId(r.member_id);
    setSalesTargetKey(`member:${r.member_id}`);
    setPendingEditing(null);
    setParentId(r.parent_leader_member_id);
    setReason(r.reason ?? '');
    setUnitPrice(Number(r.special_unit_price ?? 100000));
    setUnitLimit(Number(r.special_unit_limit ?? 10));
    setEffectiveFrom((r.effective_from ?? '').slice(0, 10));
    setEffectiveTo((r.effective_to ?? '') || '');
    setStatus(r.status ?? 'active');
    setNote(r.note ?? '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetForm() {
    setEditingMemberId(null);
    setMemberId('');
    setParentId('');
    setReason('코드 선발급');
    setUnitPrice(100000);
    setUnitLimit(10);
    setEffectiveFrom('');
    setEffectiveTo('');
    setStatus('active');
    setNote('');
    setPendingEditing(null);
    setSalesTargetKey('');
  }

  async function reserveForPendingAccount(p: PendingAccountRow) {
    setError(null);
    setOk(null);
    setPendingEditing(p);
    setMemberId('');
    setEditingMemberId(null);
    setSalesTargetKey(`pending:${p.id}`);
    // 상위리더/단가/구좌 등은 기존 입력을 그대로 쓰되, 저장은 pending API로 보낸다.
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submitPendingReservation(changeType: 'CREATE' | 'UPDATE' = 'CREATE') {
    setError(null);
    setOk(null);
    if (!pendingEditing) return setError('예약 대상 계정을 선택해주세요.');
    if (!parentId) return setError('상위리더를 선택해주세요.');
    if (!reason.trim()) return setError('사유를 입력해주세요.');
    if (!(Number(unitPrice) > 0)) return setError('적용단가는 0보다 커야 합니다.');
    if (!(Number(unitLimit) > 0)) return setError('적용구좌는 0보다 커야 합니다.');

    setSaving(true);
    try {
      const changeReason = window.prompt('변경 사유를 입력해주세요.', changeType) ?? changeType;
      const res = await fetch('/api/admin/sales/pre-issued-code-pending', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert',
          user_profile_id: pendingEditing.id,
          desired_parent_leader_member_id: parentId,
          reason,
          special_unit_price: Number(unitPrice),
          special_unit_limit: Number(unitLimit),
          effective_from: effectiveFrom || undefined,
          effective_to: effectiveTo || null,
          desired_status: status,
          note: note || null,
          change_reason: `${changeType}:${changeReason}`,
        }),
      });
      const data = await res.json();
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error ?? '예약 저장 실패');
      }
      setOk('예약 등록 완료. (member_id 매핑 후 자동 승격 대상)');
      // 예약 목록이 같은 페이지에서 바로 보여야 혼동이 없음 → 저장 후 새로고침
      window.location.reload();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  async function promotePendingNow(userProfileId: string) {
    setError(null);
    setOk(null);
    setSaving(true);
    try {
      const res = await fetch('/api/admin/sales/pre-issued-code-pending', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'promote', user_profile_id: userProfileId }),
      });
      const data = await res.json();
      if (!res.ok || data?.success === false) throw new Error(data?.error ?? data?.message ?? '승격 실패');
      setOk(data?.message ?? '승격 완료');
      window.location.reload();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  async function submit(changeType: 'CREATE' | 'UPDATE' | 'SUSPEND' | 'RESUME' | 'END' | 'UPSERT') {
    setError(null);
    setOk(null);
    if (!memberId) return setError('영업자를 선택해주세요.');
    if (!parentId) return setError('상위리더를 선택해주세요.');
    if (memberId === parentId) return setError('상위리더는 본인과 동일할 수 없습니다.');
    if (!reason.trim()) return setError('사유를 입력해주세요.');
    if (!(Number(unitPrice) > 0)) return setError('적용단가는 0보다 커야 합니다.');
    if (!(Number(unitLimit) > 0)) return setError('적용구좌는 0보다 커야 합니다.');

    setSaving(true);
    try {
      const changeReason = window.prompt('변경 사유를 입력해주세요.', changeType) ?? changeType;
      const res = await fetch('/api/admin/sales/pre-issued-code-members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          member_id: memberId,
          parent_leader_member_id: parentId,
          reason,
          special_unit_price: Number(unitPrice),
          special_unit_limit: Number(unitLimit),
          effective_from: effectiveFrom || undefined,
          effective_to: effectiveTo || null,
          status,
          note: note || null,
          change_reason: changeType,
          changed_by: 'admin',
          change_reason_text: changeReason,
        }),
      });
      const data = await res.json();
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error ?? '저장 실패');
      }
      setOk('저장 완료. 목록을 갱신합니다.');
      // 최신 목록 재조회
      const rr = await fetch('/api/admin/sales/pre-issued-code-members');
      const jj = await rr.json();
      if (rr.ok && jj?.success) {
        setSettings(jj.data as SettingRow[]);
      } else {
        setTimeout(() => window.location.reload(), 300);
      }
      if (changeType === 'CREATE' || changeType === 'UPDATE' || changeType === 'UPSERT') {
        resetForm();
      }
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  async function act(row: SettingRow, next: Partial<Pick<SettingRow, 'status' | 'effective_to'>>) {
    // row 기반으로 전체 payload를 보내되, status/effective_to만 조정
    setMemberId(row.member_id);
    setParentId(row.parent_leader_member_id);
    setReason(row.reason ?? '');
    setUnitPrice(Number(row.special_unit_price ?? 100000));
    setUnitLimit(Number(row.special_unit_limit ?? 10));
    setEffectiveFrom((row.effective_from ?? '').slice(0, 10));
    setEffectiveTo(next.effective_to ?? (row.effective_to ?? '') ?? '');
    setStatus((next.status ?? row.status) as Status);
    setNote(row.note ?? '');
    const typ =
      next.status === 'paused'
        ? 'SUSPEND'
        : next.status === 'active' && row.status === 'paused'
          ? 'RESUME'
          : next.status === 'ended'
            ? 'END'
            : 'UPDATE';
    await submit(typ);
  }

  async function openHistory(row: SettingRow) {
    setHistory(null);
    setHistoryFor(row.member_id);
    try {
      const sp = new URLSearchParams();
      sp.set('member_id', row.member_id);
      const res = await fetch(`/api/admin/sales/pre-issued-code-members?${sp.toString()}`);
      const data = await res.json();
      if (!res.ok || data?.success === false) throw new Error(data?.error ?? '이력 조회 실패');
      setHistory(data?.data?.history ?? []);
    } catch (e: any) {
      setHistory([{ id: 'err', changed_at: '', change_reason: 'ERROR', changed_by: '', before_json: null, after_json: { error: String(e?.message ?? e) } }]);
    }
  }

  function closeHistory() {
    setHistory(null);
    setHistoryFor(null);
  }

  return (
    <>
      <div className="mb-4 rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <div className="text-xs font-semibold text-gray-800">코드 선발급자 등록/수정</div>
          <div className="text-[11px] text-gray-500 mt-1">
            월말 기준 활성 설정이 해당 월 전체 오버라이드/롤업 경로에 적용됩니다.
          </div>
        </div>
        <div className="px-4 py-3 grid gap-3 sm:grid-cols-2 text-xs">
        {pendingEditing ? (
          <div className="sm:col-span-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <div className="font-semibold">예약 등록 대상(미매핑 계정)</div>
            <div className="mt-1 text-[11px] text-amber-800">
              {extractName(pendingEditing.pre_issued_name ?? pendingEditing.display_name ?? '-')} · {pendingEditing.login_code} · {maskPhone(pendingEditing.pre_issued_phone ?? pendingEditing.phone)}
            </div>
            <div className="mt-1 text-[11px] text-amber-800">
              이 계정은 아직 <span className="font-semibold">member_id가 없어</span> 특례/오버라이드가 적용되지 않습니다. 매핑되면 자동 승격됩니다.
            </div>
          </div>
        ) : null}
        <label className="flex flex-col gap-1">
          <SalesTargetSearchPicker
            label="영업자"
            memberOptions={memberOptions}
            pendingAccounts={props.pendingAccounts ?? []}
            selectedKey={salesTargetKey}
            onSelect={(opt) => {
              setError(null);
              setOk(null);
              if (!opt) {
                setSalesTargetKey('');
                setMemberId('');
                setEditingMemberId(null);
                setPendingEditing(null);
                return;
              }
              setSalesTargetKey(opt.key);
              if (opt.kind === 'pending') {
                const p = (props.pendingAccounts ?? []).find((x) => x.id === opt.id) ?? null;
                setPendingEditing(p);
                setMemberId('');
                setEditingMemberId(null);
              } else {
                setPendingEditing(null);
                setMemberId(opt.id);
                setEditingMemberId(opt.id);
              }
            }}
          />
        </label>

        <label className="flex flex-col gap-1">
          <MemberSearchPicker
            label="상위리더(필수)"
            members={memberOptions}
            selectedId={parentId}
            onSelect={(id) => setParentId(id)}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-semibold text-gray-700">사유</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="rounded-md border border-gray-200 px-2 py-2"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-semibold text-gray-700">상태</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as Status)}
            className="rounded-md border border-gray-200 px-2 py-2"
          >
            <option value="active">적용중</option>
            <option value="paused">중지</option>
            <option value="ended">종료</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-semibold text-gray-700">적용단가</span>
          <input
            type="number"
            value={unitPrice}
            onChange={(e) => setUnitPrice(Number(e.target.value))}
            className="rounded-md border border-gray-200 px-2 py-2 tabular-nums"
          />
          <span className="text-[11px] text-gray-500">현재 입력: {fmtWon(unitPrice)}</span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-semibold text-gray-700">적용구좌</span>
          <input
            type="number"
            value={unitLimit}
            onChange={(e) => setUnitLimit(Number(e.target.value))}
            className="rounded-md border border-gray-200 px-2 py-2 tabular-nums"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-semibold text-gray-700">적용 시작일</span>
          <input
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            className="rounded-md border border-gray-200 px-2 py-2"
          />
          <span className="text-[11px] text-gray-500">비우면 오늘로 저장됩니다.</span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-semibold text-gray-700">종료일(선택)</span>
          <input
            type="date"
            value={effectiveTo}
            onChange={(e) => setEffectiveTo(e.target.value)}
            className="rounded-md border border-gray-200 px-2 py-2"
          />
        </label>

        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="font-semibold text-gray-700">비고</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="rounded-md border border-gray-200 px-2 py-2"
          />
        </label>

        <div className="sm:col-span-2 flex items-center justify-between gap-3">
          <div className="text-xs">
            {error ? <span className="text-red-600 font-semibold">{error}</span> : null}
            {ok ? <span className="text-emerald-700 font-semibold">{ok}</span> : null}
          </div>
          <div className="flex items-center gap-2">
            {pendingEditing ? (
              <button
                type="button"
                onClick={() => setPendingEditing(null)}
                className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700"
              >
                예약 취소
              </button>
            ) : editingMemberId ? (
              <button
                type="button"
                onClick={resetForm}
                className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700"
              >
                편집 취소
              </button>
            ) : null}
            <button
              type="button"
              onClick={() =>
                pendingEditing
                  ? submitPendingReservation('CREATE')
                  : submit(editingMemberId ? 'UPDATE' : 'CREATE')
              }
              disabled={saving}
              className="rounded-md bg-orange-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {saving ? '저장 중…' : pendingEditing ? '예약 등록' : editingMemberId ? '수정 저장' : '등록'}
            </button>
          </div>
        </div>
      </div>
    </div>

      {props.pendingSettings?.length ? (
        <div className="mb-4 rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
            <div className="text-xs font-semibold text-gray-800">예약 등록(미매핑 계정) 목록</div>
            <div className="text-[11px] text-gray-500 mt-1">
              여기의 항목은 <span className="font-semibold">정산/오버라이드에 적용되지 않으며</span>, member_id 매핑 시 자동 승격됩니다.
            </div>
          </div>
          <div className="px-4 py-3 overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="text-gray-600">
                <tr>
                  {['계정', '상위리더', '단가/한도', '기간', '상태', '승격', '오류'].map((h) => (
                    <th key={h} className="py-1 pr-3 text-left font-semibold whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-gray-800/90">
                {(props.pendingSettings ?? []).slice(0, 30).map((r: any) => {
                  const p =
                    (props.pendingAccounts ?? []).find((x) => x.id === String(r.user_profile_id)) ??
                    null;
                  const parent = members.find((m) => m.id === String(r.desired_parent_leader_member_id)) ?? null;
                  const name = extractName(p?.pre_issued_name ?? p?.display_name ?? '미매핑 계정');
                  const login = p?.login_code ?? '';
                  const phone = maskPhone(p?.pre_issued_phone ?? p?.phone);
                  return (
                    <tr key={String(r.id)} className="border-t border-gray-100">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <div className="font-semibold">{name}</div>
                        <div className="text-[10px] text-gray-500 font-mono">
                          {login ? `${login} · ` : ''}
                          {phone}
                        </div>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {parent ? (
                          <span className="font-semibold">
                            {parent.name} ({parent.rank})
                          </span>
                        ) : (
                          <span className="text-gray-500">-</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <span className="font-semibold">{fmtWon(Number(r.special_unit_price ?? 0))}</span> /{' '}
                        {Number(r.special_unit_limit ?? 0)}구좌
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap tabular-nums">
                        {String(r.effective_from ?? '').slice(0, 10)}
                        {r.effective_to ? ` ~ ${String(r.effective_to).slice(0, 10)}` : ''}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">{String(r.desired_status ?? '')}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {r.promoted ? (
                          <span className="text-emerald-700 font-semibold">승격완료</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => promotePendingNow(String(r.user_profile_id))}
                            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
                          >
                            지금 승격 시도
                          </button>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-[10px] text-red-600">
                        {String(r.last_promotion_error ?? '')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {props.pendingAccounts?.length ? (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <div className="font-semibold">계정은 발급됐지만 조직원 매핑(member_id)이 없는 계정</div>
          <div className="text-[11px] text-amber-800 mt-1 leading-relaxed">
            아래 계정은 <span className="font-semibold">user_profiles.member_id가 NULL(PENDING)</span> 상태입니다.
            여기서 <span className="font-semibold">예약 등록</span>을 해두면, 이후 <span className="font-semibold">계정 발급 → 매핑</span>에서
            조직원(member_id)으로 매핑되는 순간 자동으로 본 설정으로 승격됩니다.
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="text-amber-900/80">
                <tr>
                  {['이름', '로그인코드', '전화', '상태', ''].map((h) => (
                    <th key={h} className="py-1 pr-3 text-left font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-amber-900/90">
                {props.pendingAccounts.slice(0, 8).map((p) => (
                  <tr key={p.id}>
                    <td className="py-1 pr-3 whitespace-nowrap">
                      {extractName(p.pre_issued_name ?? p.display_name ?? '-') || '-'}
                    </td>
                    <td className="py-1 pr-3 font-mono whitespace-nowrap">{p.login_code}</td>
                    <td className="py-1 pr-3 whitespace-nowrap">{maskPhone(p.pre_issued_phone ?? p.phone)}</td>
                    <td className="py-1 pr-3 whitespace-nowrap">{p.mapping_status}</td>
                    <td className="py-1 pr-3 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => reserveForPendingAccount(p)}
                        className="rounded-md border border-amber-300 bg-white px-2 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-100"
                      >
                        예약 등록
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2">
            <a className="text-amber-900 underline font-semibold" href="/admin/account-issue">
              계정 발급/매핑 화면으로 이동
            </a>
          </div>
        </div>
      ) : null}

      <PreIssuedCodeMembersTable
        rows={settings}
        onEdit={(r) => fillFromRow(r)}
        onSuspend={(r) => act(r, { status: 'paused' })}
        onResume={(r) => act(r, { status: 'active' })}
        onEnd={(r) => {
          const today = new Date().toISOString().slice(0, 10);
          const end = window.prompt('종료일(YYYY-MM-DD)을 입력하세요. 비우면 오늘로 설정됩니다.', today) ?? today;
          return act(r, { status: 'ended', effective_to: end });
        }}
        onHistory={(r) => openHistory(r)}
      />

      {historyFor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-3xl rounded-lg bg-white shadow-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-800">변경 이력</div>
              <button
                type="button"
                onClick={closeHistory}
                className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-gray-700"
              >
                닫기
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                  <tr>
                    {['변경일시', '변경자', '유형', 'before', 'after'].map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(history ?? []).map((h: any) => (
                    <tr key={String(h.id)}>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                        {String(h.changed_at ?? '')}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{String(h.changed_by ?? '')}</td>
                      <td className="px-3 py-2 whitespace-nowrap font-semibold">{String(h.change_reason ?? '')}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-gray-600">
                        {h.before_json ? JSON.stringify(h.before_json) : '-'}
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] text-gray-600">
                        {h.after_json ? JSON.stringify(h.after_json) : '-'}
                      </td>
                    </tr>
                  ))}
                  {history && history.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-10 text-center text-sm text-gray-500">
                        이력이 없습니다.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

// 아래: 목록 + 액션 + 이력 보기
export function PreIssuedCodeMembersTable(props: {
  rows: SettingRow[];
  onEdit: (r: SettingRow) => void;
  onSuspend: (r: SettingRow) => void;
  onResume: (r: SettingRow) => void;
  onEnd: (r: SettingRow) => void;
  onHistory: (r: SettingRow) => void;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs sm:text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {[
                '이름',
                '현재 직급',
                '상위리더',
                '사유',
                '적용단가',
                '적용구좌',
                '적용 시작',
                '종료',
                '상태',
                '액션',
              ].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {props.rows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-3 py-2 whitespace-nowrap font-semibold text-gray-800">{r.member_name}</td>
                <td className="px-3 py-2 whitespace-nowrap text-gray-600">{r.member_rank}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {r.parent_name} <span className="text-gray-400">({r.parent_rank})</span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-gray-700">{r.reason}</td>
                <td className="px-3 py-2 tabular-nums text-right">{fmtWon(r.special_unit_price)}</td>
                <td className="px-3 py-2 tabular-nums text-right">{r.special_unit_limit.toLocaleString()}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.effective_from}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.effective_to ?? '-'}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.status}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => props.onEdit(r)}
                      className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      수정
                    </button>
                    {r.status === 'active' ? (
                      <button
                        type="button"
                        onClick={() => props.onSuspend(r)}
                        className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-100"
                      >
                        중지
                      </button>
                    ) : null}
                    {r.status === 'paused' ? (
                      <button
                        type="button"
                        onClick={() => props.onResume(r)}
                        className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100"
                      >
                        재개
                      </button>
                    ) : null}
                    {r.status !== 'ended' ? (
                      <button
                        type="button"
                        onClick={() => props.onEnd(r)}
                        className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-800 hover:bg-rose-100"
                      >
                        종료
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => props.onHistory(r)}
                      className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      이력 보기
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {props.rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-sm text-gray-500">
                  표시할 설정이 없습니다.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

