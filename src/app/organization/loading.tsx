export default function OrganizationLoading() {
  return (
    <div className="p-3 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4 sm:mb-6">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-800">내 조직도</h2>
          <p className="text-sm text-gray-500 mt-0.5">불러오는 중…</p>
        </div>
      </div>

      {/* 월 버튼 영역 스켈레톤 */}
      <div className="flex gap-1 mb-4 sm:mb-5 items-center overflow-x-auto whitespace-nowrap -mx-3 px-3 sm:mx-0 sm:px-0">
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="px-2.5 py-1 rounded text-xs border border-gray-200 bg-gray-100 text-transparent select-none animate-pulse"
          >
            00월
          </div>
        ))}
      </div>

      {/* 본문 카드 스켈레톤 */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="h-4 w-48 bg-gray-100 rounded animate-pulse" />
        <div className="mt-3 space-y-2">
          <div className="h-3 w-full bg-gray-100 rounded animate-pulse" />
          <div className="h-3 w-11/12 bg-gray-100 rounded animate-pulse" />
          <div className="h-3 w-10/12 bg-gray-100 rounded animate-pulse" />
          <div className="h-3 w-9/12 bg-gray-100 rounded animate-pulse" />
        </div>
      </div>
    </div>
  );
}

