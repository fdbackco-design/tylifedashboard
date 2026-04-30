'use client';

export default function OrganizationLoading() {
  return (
    <div className="p-6">
      <div className="mb-4 px-3 py-2 rounded border border-slate-200 bg-slate-50 text-slate-700 text-sm">
        이동 중…
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="h-7 w-32 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-56 bg-slate-100 rounded mt-2 animate-pulse" />
        </div>
      </div>

      <div className="flex gap-1 mb-5 flex-wrap items-center">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-7 w-14 bg-slate-100 border border-slate-200 rounded animate-pulse" />
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="h-6 w-40 bg-slate-100 rounded animate-pulse" />
        <div className="h-4 w-72 bg-slate-50 rounded mt-3 animate-pulse" />
        <div className="h-4 w-64 bg-slate-50 rounded mt-2 animate-pulse" />
        <div className="h-4 w-80 bg-slate-50 rounded mt-2 animate-pulse" />
      </div>
    </div>
  );
}

