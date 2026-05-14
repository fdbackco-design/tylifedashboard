import Image from 'next/image';

export type TyLifePartnersLogoProps = {
  /** 로그인 카드 상단 등 */
  variant?: 'hero' | 'header';
  className?: string;
  priority?: boolean;
  /** 지정 시 640px 미만에서만 이 이미지를 쓰고, `sm` 이상에서는 기본 TY Life Partners 로고를 씁니다. */
  mobileSrc?: string;
};

const variantWrap: Record<NonNullable<TyLifePartnersLogoProps['variant']>, string> = {
  hero: 'w-full max-w-[min(100%,280px)]',
  header: 'w-full max-w-[200px] sm:max-w-[220px]',
};

export default function TyLifePartnersLogo({
  variant = 'header',
  className = '',
  priority = false,
  mobileSrc,
}: TyLifePartnersLogoProps) {
  const desktop = (
    <Image
      src="/ty-life-partners-logo.png"
      alt="TY Life Partners"
      width={440}
      height={176}
      className={`h-auto w-full object-contain object-left ${mobileSrc ? 'hidden sm:block' : ''}`}
      priority={priority}
    />
  );

  return (
    <div className={`${variantWrap[variant]} ${className}`.trim()}>
      {mobileSrc ? (
        <>
          <Image
            src={mobileSrc}
            alt="TY Life Partners"
            width={440}
            height={176}
            className="h-auto w-full object-contain object-left sm:hidden"
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
