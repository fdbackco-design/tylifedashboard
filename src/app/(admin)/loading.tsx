export default function Loading() {
  return (
    <div className="p-6 animate-pulse">
      <div className="h-7 w-40 bg-gray-200 rounded mb-4" />
      <div className="h-4 w-72 bg-gray-200 rounded mb-6" />

      <div className="space-y-3">
        <div className="h-24 bg-gray-100 rounded-lg border border-gray-200" />
        <div className="h-24 bg-gray-100 rounded-lg border border-gray-200" />
        <div className="h-24 bg-gray-100 rounded-lg border border-gray-200" />
      </div>
    </div>
  );
}

