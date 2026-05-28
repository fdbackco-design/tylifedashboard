'use client';

import { NOTICE_MAX_FILE_BYTES } from '@/lib/notices/constants';
import { sanitizeNoticeHtml } from '@/lib/notices/storage';
import { uploadNoticeFile } from '@/lib/notices/upload-client';
import { useCallback, useEffect, useRef, useState } from 'react';

type Props = {
  value: string;
  onChange: (html: string) => void;
  noticeId?: string;
  onError?: (message: string) => void;
  pendingBlobImagesRef: React.MutableRefObject<Map<string, File>>;
  disabled?: boolean;
};

async function uploadInlineImage(noticeId: string, file: File): Promise<string> {
  const { storage_path } = await uploadNoticeFile(noticeId, file, 'inline');
  const res = await fetch(`/api/admin/notices/${noticeId}/content-images`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storage_path }),
  });
  const json = (await res.json()) as { success?: boolean; error?: string; data?: { url: string } };
  if (!res.ok || !json.success || !json.data?.url) {
    throw new Error(json.error ?? '이미지 업로드 실패');
  }
  return json.data.url;
}

export default function NoticeContentEditor({
  value,
  onChange,
  noticeId,
  onError,
  pendingBlobImagesRef,
  disabled,
}: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const syncFromValue = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const next = value || '';
    if (el.innerHTML !== next) {
      el.innerHTML = next;
    }
  }, [value]);

  useEffect(() => {
    syncFromValue();
  }, [syncFromValue]);

  const emitChange = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    onChange(sanitizeNoticeHtml(el.innerHTML));
  }, [onChange]);

  const insertImageAtSelection = useCallback(
    (src: string, alt?: string) => {
      const el = editorRef.current;
      if (!el) return;
      el.focus();
      const img = document.createElement('img');
      img.src = src;
      img.alt = alt ?? '';
      img.className = 'max-w-full h-auto rounded-lg my-2';
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(img);
        range.setStartAfter(img);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        el.appendChild(img);
      }
      emitChange();
    },
    [emitChange],
  );

  const handleImageFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) {
        onError?.('이미지 파일만 본문에 넣을 수 있습니다.');
        return;
      }
      if (file.size > NOTICE_MAX_FILE_BYTES) {
        onError?.('이미지 크기는 10MB 이하여야 합니다.');
        return;
      }

      setUploading(true);
      try {
        if (noticeId) {
          const url = await uploadInlineImage(noticeId, file);
          insertImageAtSelection(url, file.name);
        } else {
          const blobUrl = URL.createObjectURL(file);
          pendingBlobImagesRef.current.set(blobUrl, file);
          insertImageAtSelection(blobUrl, file.name);
        }
      } catch (e) {
        onError?.(e instanceof Error ? e.message : String(e));
      } finally {
        setUploading(false);
      }
    },
    [noticeId, onError, pendingBlobImagesRef, insertImageAtSelection],
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled || uploading}
          onClick={() => imageInputRef.current?.click()}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {uploading ? '업로드 중…' : '본문에 이미지 삽입'}
        </button>
        {!noticeId ? (
          <span className="text-xs text-slate-400">게시 시 이미지가 서버에 저장됩니다.</span>
        ) : null}
      </div>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleImageFile(file);
          e.target.value = '';
        }}
      />
      <div
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline
        data-placeholder="공지 내용을 입력하세요. 이미지는 버튼·붙여넣기로 본문에 넣을 수 있습니다."
        onInput={emitChange}
        onBlur={emitChange}
        onPaste={(e) => {
          const items = e.clipboardData?.items;
          if (!items) return;
          for (const item of Array.from(items)) {
            if (item.type.startsWith('image/')) {
              e.preventDefault();
              const file = item.getAsFile();
              if (file) void handleImageFile(file);
              return;
            }
          }
        }}
        className="notice-content-editor min-h-[240px] w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-200 [&_img]:my-2 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-lg empty:before:text-slate-400 empty:before:content-[attr(data-placeholder)]"
      />
    </div>
  );
}
