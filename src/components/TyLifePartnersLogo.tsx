import Image from 'next/image';

export type TyLifePartnersLogoProps = {
  /** 로그인 카드 상단 등 */
  variant?: 'hero' | 'header';
  className?: string;
  priority?: boolean;
  /** 지정 시 640px 미만에서만 이 이미지를 쓰고, `sm` 이상에서는 기본 Feed Life 로고를 씁니다. */
  mobileSrc?: string;
  /** `header`에서 모바일 높이·폭을 줄일 때 */
  density?: 'default' | 'compact';
};

const variantWrap: Record<NonNullable<TyLifePartnersLogoProps['variant']>, string> = {
  hero: 'w-full max-w-[min(100%,280px)]',
  header: 'w-full max-w-[200px] sm:max-w-[220px]',
};

const headerCompactWrap =
  'w-full max-h-[38px] max-w-[min(100%,148px)] sm:max-h-none sm:max-w-[200px] lg:max-w-[220px]';

export default function TyLifePartnersLogo({
  variant = 'header',
  className = '',
  priority = false,
  mobileSrc,
  density = 'default',
}: TyLifePartnersLogoProps) {
  const wrap =
    variant === 'header' && density === 'compact' ? headerCompactWrap : variantWrap[variant];

  const desktop = (
    <Image
      src="/logo.png"
      alt="Feed Life"
      width={440}
      height={176}
      className={`h-auto w-full object-contain object-left ${mobileSrc ? 'hidden sm:block' : ''}`}
      priority={priority}
    />
  );

  return (
    <div className={`${wrap} ${className}`.trim()}>
      {mobileSrc ? (
        <>
          <Image
            src={mobileSrc}
            alt="Feed Life"
            width={440}
            height={176}
            className={`h-auto w-full object-contain object-left sm:hidden ${density === 'compact' ? 'max-h-[38px]' : ''}`}
            priority={priority}
          />
          {desktop}
        </>
      ) : (
        desktop
      )}
    </div>
  );
}
