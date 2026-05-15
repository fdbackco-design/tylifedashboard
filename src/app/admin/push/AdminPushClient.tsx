'use client';

import LoadingButton from '@/components/ui/LoadingButton';
import { useState } from 'react';

type SendResult = {
  sent: number;
  failed: number;
  removed: number;
  errors: string[];
  message?: string;
};

export default function AdminPushClient() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('/organization');
  const [targetMode, setTargetMode] = useState<'all' | 'user'>('all');
  const [targetUserName, setTargetUserName] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    if (!title.trim() || !body.trim()) {
      setErr('제목과 내용을 입력해주세요.');
      return;
    }
    if (targetMode === 'user' && !targetUserName.trim()) {
      setErr('대상 사용자 이름을 입력해주세요.');
      return;
    }

    setLoading(true);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch('/api/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          url: url.trim() || '/organization',
          ...(targetMode === 'user' ? { targetUserName: targetUserName.trim() } : {}),
        }),
      });
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: SendResult & { targetLabel?: string };
      };
      if (!res.ok || !json.success) throw new Error(json.error ?? '발송 실패');
      const data = json.data ?? null;
      if (data?.targetLabel && targetMode === 'user') {
        setResult({ ...data, message: `${data.targetLabel} 님에게 발송` });
      } else {
        setResult(data);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6 max-w-xl">
      <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
        <p className="font-medium">개인정보 안내</p>
        <p className="mt-1 text-xs leading-relaxed text-amber-800/90">
          푸시 본문에는 주민번호, 계약 상세 등 민감 정보를 넣지 마세요.
        </p>
        {/* TODO: 개인정보처리방침에 푸시 알림, 기기 push endpoint/keys, user_agent 수집·이용 목적 반영 여부 검토 */}
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <h3 className="text-sm font-semibold text-orange-950">메시지</h3>
        <label className="block">
          <span className="text-xs font-medium text-slate-600">제목</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="예: 새 공지가 등록되었습니다"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600">내용</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="짧은 안내 문구"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600">탭 시 이동 URL</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
            placeholder="/organization/notice"
          />
        </label>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
        <h3 className="text-sm font-semibold text-orange-950">발송 대상</h3>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="target"
              checked={targetMode === 'all'}
              onChange={() => setTargetMode('all')}
            />
            전체 구독자
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="target"
              checked={targetMode === 'user'}
              onChange={() => setTargetMode('user')}
            />
            특정 사용자
          </label>
        </div>
        {targetMode === 'user' ? (
          <label className="block">
            <span className="text-xs font-medium text-slate-600">사용자 이름</span>
            <input
              value={targetUserName}
              onChange={(e) => setTargetUserName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              placeholder="예: 홍길동"
            />
            <p className="mt-1 text-[11px] text-slate-400">
              조직도에 표시되는 이름(예: 홍길동)으로 검색합니다. [고객] 접두어는 입력하지 않아도 됩니다.
            </p>
          </label>
        ) : null}
      </section>

      {err ? <p className="text-sm text-red-600">{err}</p> : null}

      {result ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
          <p className="font-medium text-slate-800">발송 결과</p>
          {result.message ? <p className="mt-1 text-slate-600">{result.message}</p> : null}
          <ul className="mt-2 space-y-1 text-slate-600 tabular-nums">
            <li>성공: {result.sent}</li>
            <li>실패: {result.failed}</li>
            <li>만료 구독 삭제: {result.removed}</li>
          </ul>
          {result.errors.length > 0 ? (
            <p className="mt-2 text-xs text-red-600">오류 샘플: {result.errors.join(' · ')}</p>
          ) : null}
        </div>
      ) : null}

      <LoadingButton
        type="button"
        isLoading={loading}
        onClick={() => void send()}
        className="rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50"
      >
        푸시 발송
      </LoadingButton>
    </div>
  );
}
