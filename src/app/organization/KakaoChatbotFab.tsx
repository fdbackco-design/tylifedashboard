import Image from 'next/image';

const KAKAO_CHAT_URL = 'http://pf.kakao.com/_dVxmxlX/chat';

/** /organization 우측 하단 카카오톡 상담 플로팅 버튼 */
export default function KakaoChatbotFab() {
  return (
    <a
      href={KAKAO_CHAT_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="카카오톡 상담하기"
      className="fixed z-40 right-4 flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full shadow-lg ring-1 ring-black/5 transition hover:scale-105 hover:shadow-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 sm:h-16 sm:w-16 bottom-[calc(1.25rem+env(safe-area-inset-bottom,0px))]"
    >
      <Image
        src="/chatbot.png"
        alt=""
        width={64}
        height={64}
        className="h-full w-full object-cover"
        sizes="64px"
        priority={false}
      />
    </a>
  );
}
