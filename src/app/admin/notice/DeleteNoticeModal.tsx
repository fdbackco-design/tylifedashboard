'use client';

type Props = {
  open: boolean;
  title: string;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function DeleteNoticeModal({ open, title, loading, onCancel, onConfirm }: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-notice-title"
    >
      <button
        type="button"
        aria-label="닫기"
        className="absolute inset-0 bg-black/40"
        onClick={() => {
          if (!loading) onCancel();
        }}
      />
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-900/10">
        <div
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600"
          aria-hidden
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>
        <h2 id="delete-notice-title" className="mt-4 text-center text-lg font-bold text-slate-900">
          공지사항을 삭제하시겠습니까?
        </h2>
        <p className="mt-2 text-center text-sm text-slate-500">
          삭제된 공지는 복구할 수 없으며,
          <br />
          영업자 앱에서도 즉시 사라집니다.
        </p>
        <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2.5 text-center">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">삭제 대상</p>
          <p className="mt-1 truncate text-sm font-medium text-slate-800">{title}</p>
        </div>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={onCancel}
            className="flex-1 rounded-lg border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onConfirm}
            className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? '삭제 중…' : '삭제'}
          </button>
        </div>
      </div>
    </div>
  );
}
