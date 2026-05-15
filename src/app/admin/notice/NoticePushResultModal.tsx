'use client';

type Props = {
  open: boolean;
  variant: 'success' | 'warning';
  title: string;
  message: string;
  onClose: () => void;
};

export default function NoticePushResultModal({ open, variant, title, message, onClose }: Props) {
  if (!open) return null;

  const isSuccess = variant === 'success';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="push-result-title"
    >
      <button type="button" aria-label="닫기" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-900/10">
        <div
          className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${
            isSuccess ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
          }`}
          aria-hidden
        >
          {isSuccess ? (
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
              <path d="M22 4L12 14.01l-3-3" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          )}
        </div>
        <h2 id="push-result-title" className="mt-4 text-center text-lg font-bold text-slate-900">
          {title}
        </h2>
        <p className="mt-2 text-center text-sm text-slate-600 whitespace-pre-line">{message}</p>
        <button
          type="button"
          onClick={onClose}
          className={`mt-5 w-full rounded-lg py-2.5 text-sm font-semibold text-white ${
            isSuccess ? 'bg-orange-500 hover:bg-orange-600' : 'bg-slate-800 hover:bg-slate-900'
          }`}
        >
          확인
        </button>
      </div>
    </div>
  );
}
