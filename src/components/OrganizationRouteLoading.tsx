import Image from 'next/image';

/** `/organization`, `/organization/statement` 라우트 전환 시 로딩 UI */
export default function OrganizationRouteLoading() {
  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-5 bg-gradient-to-b from-orange-200 via-orange-300 to-orange-400 px-6"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <Image
        src="/logo.png"
        alt="TY Life Partners"
        width={200}
        height={200}
        priority
        className="h-24 w-auto max-w-[min(100%,220px)] object-contain drop-shadow-md sm:h-28"
      />
      <p className="text-center text-base font-semibold tracking-tight text-[#5a5656] sm:text-lg">
        잠시만 기다려주세요...
      </p>
    </div>
  );
}
