import Image from 'next/image';

export type TyLifePartnersLogoProps = {
  /** 로그인 카드 상단 등 */
  variant?: 'hero' | 'header';
  className?: string;
  priority?: boolean;
};

const variantWrap: Record<NonNullable<TyLifePartnersLogoProps['variant']>, string> = {
  hero: 'w-full max-w-[min(100%,280px)]',
  header: 'w-full max-w-[200px] sm:max-w-[220px]',
};

export default function TyLifePartnersLogo({
  variant = 'header',
  className = '',
  priority = false,
}: TyLifePartnersLogoProps) {
  return (
    <div className={`${variantWrap[variant]} ${className}`.trim()}>
      <Image
        src="/ty-life-partners-logo.png"
        alt="TY Life Partners"
        width={440}
        height={176}
        className="h-auto w-full object-contain object-left"
        priority={priority}
      />
    </div>
  );
}
