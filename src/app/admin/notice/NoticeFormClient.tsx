'use client';

import LoadingButton from '@/components/ui/LoadingButton';
import { NOTICE_CATEGORIES, NOTICE_MAX_FILE_BYTES } from '@/lib/notices/constants';
import type { NoticeCategory } from '@/lib/notices/constants';
import type { NoticeAttachmentRow, NoticeListItem } from '@/lib/notices/types';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { resolveNoticeContentBlobImages } from '@/lib/notices/inline-images-client';
import { sanitizeNoticeHtml } from '@/lib/notices/storage';
import { uploadNoticeFile } from '@/lib/notices/upload-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import NoticeContentEditor from './NoticeContentEditor';
import { StatusBadge } from './notice-ui';
import NoticePushResultModal from './NoticePushResultModal';
import type { NoticePushOutcome } from '@/lib/notices/push-notify';

type PushResultModalState = {
  variant: 'success' | 'warning';
  title: string;
  message: string;
};

type Props = {
  mode: 'create' | 'edit';
  noticeId?: string;
};

type PendingFile = { file: File; id: string };

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function NoticeFormClient({ mode, noticeId }: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingBlobImagesRef = useRef<Map<string, File>>(new Map());

  const [loading, setLoading] = useState(mode === 'edit');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [category, setCategory] = useState<NoticeCategory>('일반');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isPinned, setIsPinned] = useState(false);
  const [sendPush, setSendPush] = useState(false);
  const [publishStart, setPublishStart] = useState('');
  const [publishEnd, setPublishEnd] = useState('');
  const [displayStatus, setDisplayStatus] = useState<NoticeListItem['display_status'] | null>(null);

  const [attachments, setAttachments] = useState<NoticeAttachmentRow[]>([]);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [pushResultModal, setPushResultModal] = useState<PushResultModalState | null>(null);

  const load = useCallback(async () => {
    if (mode !== 'edit' || !noticeId) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/notices/${noticeId}`);
      const json = (await res.json()) as {
        success: boolean;
        data?: NoticeListItem & { attachments: NoticeAttachmentRow[] };
        error?: string;
      };
      if (!res.ok || !json.success || !json.data) throw new Error(json.error ?? '조회 실패');
      const d = json.data;
      setCategory(d.category);
      setTitle(d.title);
      setContent(d.content);
      setIsPinned(d.is_pinned);
      setSendPush(d.send_push);
      setPublishStart(d.publish_start?.slice(0, 10) ?? '');
      setPublishEnd(d.publish_end?.slice(0, 10) ?? '');
      setDisplayStatus(d.display_status);
      setAttachments(d.attachments ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [mode, noticeId]);

  useEffect(() => {
    void load();
  }, [load]);

  function onPickFiles(files: FileList | null) {
    if (!files?.length) return;
    const next: PendingFile[] = [];
    for (const file of Array.from(files)) {
      if (file.size > NOTICE_MAX_FILE_BYTES) {
        setErr('파일 크기는 10MB 이하여야 합니다.');
        continue;
      }
      next.push({ file, id: `${Date.now()}_${Math.random().toString(36).slice(2)}` });
    }
    if (next.length) setPendingFiles((prev) => [...prev, ...next]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function uploadPending(targetId: string) {
    if (!pendingFiles.length) return;
    setUploading(true);
    try {
      for (const pf of pendingFiles) {
        const { storage_path } = await uploadNoticeFile(targetId, pf.file, 'attachment');
        const res = await fetch(`/api/admin/notices/${targetId}/attachments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storage_path,
            file_name: pf.file.name,
            file_size: pf.file.size,
            mime_type: pf.file.type || 'application/octet-stream',
          }),
        });
        const json = (await res.json()) as { success?: boolean; error?: string; data?: NoticeAttachmentRow };
        if (!res.ok || !json.success) throw new Error(json.error ?? '첨부 업로드 실패');
        if (json.data) setAttachments((prev) => [...prev, json.data!]);
      }
      setPendingFiles([]);
    } finally {
      setUploading(false);
    }
  }

  async function removeAttachment(attachmentId: string) {
    if (!noticeId) return;
    setErr(null);
    try {
      const res = await fetch(`/api/admin/notices/${noticeId}/attachments/${attachmentId}`, {
        method: 'DELETE',
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) throw new Error(json.error ?? '첨부 삭제 실패');
      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  function pushOutcomeModalState(push: NoticePushOutcome | undefined): PushResultModalState | null {
    if (!push || !sendPush) return null;
    if (push.sent) {
      const { sent, failed, removed } = push.result;
      const parts = [`성공 ${sent}건`];
      if (failed) parts.push(`실패 ${failed}건`);
      if (removed) parts.push(`만료 구독 삭제 ${removed}건`);
      return {
        variant: 'success',
        title: '푸시 발송 완료',
        message: parts.join(' · '),
      };
    }
    return {
      variant: 'warning',
      title: '푸시 미발송',
      message: push.reason,
    };
  }

  function goToNoticeList() {
    router.push('/admin/notice');
    router.refresh();
  }

  function closePushResultModal() {
    setPushResultModal(null);
    goToNoticeList();
  }

  async function save() {
    if (!title.trim()) {
      setErr('제목을 입력해주세요.');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      let lastPush: NoticePushOutcome | undefined;
      let resolvedContent = sanitizeNoticeHtml(content);

      let id = noticeId;
      if (mode === 'create') {
        const res = await fetch('/api/admin/notices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category,
            title: title.trim(),
            content: '',
            is_pinned: isPinned,
            send_push: sendPush,
            is_draft: false,
            publish_start: publishStart || null,
            publish_end: publishEnd || null,
          }),
        });
        const json = (await res.json()) as { success?: boolean; error?: string; data?: NoticeListItem };
        if (!res.ok || !json.success || !json.data) throw new Error(json.error ?? '저장 실패');
        id = json.data.id;
      }

      if (id && pendingBlobImagesRef.current.size > 0) {
        resolvedContent = await resolveNoticeContentBlobImages(
          id,
          resolvedContent,
          pendingBlobImagesRef.current,
        );
        pendingBlobImagesRef.current.clear();
      }

      const payload = {
        category,
        title: title.trim(),
        content: resolvedContent,
        is_pinned: isPinned,
        send_push: sendPush,
        is_draft: false,
        publish_start: publishStart || null,
        publish_end: publishEnd || null,
      };

      if (mode === 'create' && id) {
        const res = await fetch(`/api/admin/notices/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = (await res.json()) as {
          success?: boolean;
          error?: string;
          push?: NoticePushOutcome;
        };
        if (!res.ok || !json.success) throw new Error(json.error ?? '저장 실패');
        lastPush = json.push;
      } else if (noticeId) {
        const res = await fetch(`/api/admin/notices/${noticeId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = (await res.json()) as {
          success?: boolean;
          error?: string;
          push?: NoticePushOutcome;
        };
        if (!res.ok || !json.success) throw new Error(json.error ?? '저장 실패');
        lastPush = json.push;
      }

      if (id && pendingFiles.length) await uploadPending(id);
      const pushModal = pushOutcomeModalState(lastPush);
      if (pushModal) {
        setPushResultModal(pushModal);
        return;
      }
      goToNoticeList();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-500">불러오는 중…</p>;
  }

  return (
    <>
      <NoticePushResultModal
        open={pushResultModal !== null}
        variant={pushResultModal?.variant ?? 'success'}
        title={pushResultModal?.title ?? ''}
        message={pushResultModal?.message ?? ''}
        onClose={closePushResultModal}
      />
    <div className="space-y-6 max-w-3xl">
      {displayStatus ? (
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500">현재 상태</span>
          <StatusBadge status={displayStatus} />
        </div>
      ) : null}

      {err ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p> : null}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <h3 className="text-sm font-semibold text-orange-950">기본 정보</h3>
        <label className="block">
          <span className="text-xs font-medium text-slate-600">분류</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as NoticeCategory)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-200"
          >
            {NOTICE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600">제목</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-200"
            placeholder="공지 제목"
          />
        </label>
        <div className="block">
          <span className="text-xs font-medium text-slate-600">내용</span>
          <div className="mt-1">
            <NoticeContentEditor
              value={content}
              onChange={setContent}
              noticeId={mode === 'edit' ? noticeId : undefined}
              onError={setErr}
              pendingBlobImagesRef={pendingBlobImagesRef}
              disabled={saving || uploading}
            />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <h3 className="text-sm font-semibold text-orange-950">옵션</h3>
        <ToggleRow
          label="상단 고정"
          hint="최대 3건까지 고정 가능"
          checked={isPinned}
          onChange={setIsPinned}
        />
        <ToggleRow
          label="푸시 알림 발송"
          hint="게시 즉시(또는 예약일 11시) 전체 구독자에게 발송"
          checked={sendPush}
          onChange={setSendPush}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">게시 시작일</span>
            <input
              type="date"
              value={publishStart}
              onChange={(e) => setPublishStart(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">게시 종료일</span>
            <input
              type="date"
              value={publishEnd}
              onChange={(e) => setPublishEnd(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
        </div>
        <p className="text-xs text-slate-400">
          비워두면 상시 게시로 처리됩니다.
        </p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <h3 className="text-sm font-semibold text-orange-950">첨부 파일</h3>
        <p className="text-xs text-slate-500">
          파일당 최대 10MB
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-orange-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-orange-800"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,application/pdf,application/msword,application/vnd.*,text/plain"
          onChange={(e) => onPickFiles(e.target.files)}
        />
        {attachments.length > 0 ? (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
            {attachments.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="truncate text-slate-800">{a.file_name}</span>
                <span className="shrink-0 text-xs text-slate-400">{formatBytes(a.file_size)}</span>
                {mode === 'edit' ? (
                  <button
                    type="button"
                    onClick={() => void removeAttachment(a.id)}
                    className="shrink-0 text-xs text-red-600 hover:underline"
                  >
                    삭제
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {pendingFiles.length > 0 ? (
          <ul className="divide-y divide-dashed divide-orange-100 rounded-lg border border-orange-100 bg-orange-50/30">
            {pendingFiles.map((pf) => (
              <li key={pf.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="truncate text-slate-800">{pf.file.name}</span>
                <span className="text-xs text-slate-400">{formatBytes(pf.file.size)}</span>
                <button
                  type="button"
                  onClick={() => setPendingFiles((prev) => prev.filter((x) => x.id !== pf.id))}
                  className="text-xs text-slate-500 hover:underline"
                >
                  제거
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {uploading ? <p className="text-xs text-slate-500">첨부 업로드 중…</p> : null}
      </section>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Link
          href="/admin/notice"
          className="inline-flex justify-center rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          목록으로
        </Link>
        <LoadingButton
          type="button"
          isLoading={saving || uploading}
          onClick={() => void save()}
          className="rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50"
        >
          게시
        </LoadingButton>
      </div>
    </div>
    </>
  );
}

function ToggleRow(props: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 cursor-pointer">
      <span>
        <span className="block text-sm font-medium text-slate-800">{props.label}</span>
        {props.hint ? <span className="block text-xs text-slate-400">{props.hint}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        onClick={() => props.onChange(!props.checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          props.checked ? 'bg-orange-500' : 'bg-slate-200'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            props.checked ? 'translate-x-5' : ''
          }`}
        />
      </button>
    </label>
  );
}
