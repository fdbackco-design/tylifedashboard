/**
 * 영업자별 지급명세서 표시 컴포넌트 (sheet_statement.pdf 공식 문서 스타일).
 *
 * 본 컴포넌트는 표시 전용. 데이터 조회/보안/관리자 보정값 적용/정산 계산은 변경하지 않는다.
 *
 * 디자인 구조:
 *   1. 상단 좌측 TY Life Partners 로고 / 우측 "지급 명세서" 제목
 *   2. 얇은 구분선
 *   3. 회색 정보 바 (성명 / 직책 / 정산 월 / 정산 기간)
 *   4. 짙은 네이비 강조 카드 (이번 달 실지급액)
 *   5. 오렌지 세로 라인이 달린 섹션 제목 (실적 요약 / 지급 및 공제 내역)
 *   6. 단정한 문서형 표 (헤더 회색, 본문 흰색 + 얇은 구분선, 숫자 우측 정렬)
 *   7. 사업소득세 행은 연한 베이지/오렌지 톤으로 강조
 *   8. 하단 안내문은 중앙 정렬 + 얇은 상단 구분선
 */

import TyLifePartnersLogo from '@/components/TyLifePartnersLogo';
import type { RankType } from '@/lib/types';

export interface StatementSheetViewProps {
  name: string;
  rank: RankType;
  /** "YYYY년 M월" */
  yearMonthLabelKo: string;
  /** "YYYY.MM.DD ~ YYYY.MM.DD" */
  displayWindowKo: string;
  personalUnitCount: number;
  downlineUnitCount: number;
  totalUnitCount: number;
  personalCommission: number;
  overrideAmount: number;
  bonusAmount: number;
  grossTotal: number;
  withholdingTax: number;
  netPayment: number;
}

function formatWon(n: number): string {
  return `${Math.round(n).toLocaleString('ko-KR')}`;
}

function InfoBarItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <span className="text-[11px] font-medium tracking-wide text-slate-500 sm:text-xs">{label}</span>
      <span className="text-[13px] font-semibold tabular-nums text-slate-900 sm:text-sm">{value}</span>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="border-l-4 border-orange-500 pl-3 text-[15px] font-bold tracking-tight text-slate-900 sm:pl-4 sm:text-base">
      {children}
    </h2>
  );
}

export default function StatementSheetView(props: StatementSheetViewProps) {
  const {
    name,
    rank,
    yearMonthLabelKo,
    displayWindowKo,
    personalUnitCount,
    downlineUnitCount,
    totalUnitCount,
    personalCommission,
    overrideAmount,
    bonusAmount,
    withholdingTax,
    netPayment,
  } = props;

  return (
    <article className="mx-auto w-full max-w-[900px] bg-white p-5 sm:p-10 print:p-8">
      {/* 1. 상단: 좌측 로고 / 우측 제목 */}
      <header className="flex items-center justify-between gap-4">
        <TyLifePartnersLogo className="shrink-0" mobileSrc="/logo.png" />
        <h1 className="text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">
          지급 명세서
        </h1>
      </header>

      {/* 2. 얇은 구분선 */}
      <div className="mt-4 h-px w-full bg-slate-200" />

      {/* 3. 기본 정보 바 (성명 / 직책 / 정산 월 / 정산 기간) */}
      <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg bg-slate-50 px-4 py-3.5 sm:px-5 sm:py-4">
        <InfoBarItem label="성명" value={name} />
        <InfoBarItem label="직책" value={rank} />
        <InfoBarItem label="정산 월" value={yearMonthLabelKo} />
        <InfoBarItem label="정산 기간" value={displayWindowKo} />
      </div>

      {/* 4. 실지급액 강조 카드 (네이비) */}
      <div className="mt-6 rounded-xl bg-[#2B3D50] px-6 py-7 text-center text-white sm:mt-7 sm:px-8 sm:py-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70 sm:text-xs">
          이번 달 실지급액
        </p>
        <p className="mt-1.5 text-3xl font-extrabold tabular-nums tracking-tight sm:text-5xl">
          {formatWon(netPayment)}
          <span className="ml-1 text-base font-semibold text-white/80 sm:ml-2 sm:text-xl">원</span>
        </p>
      </div>

      {/* 5. 실적 요약 */}
      <section className="mt-8 sm:mt-10">
        <SectionHeading>실적 요약</SectionHeading>
        <div className="mt-3 overflow-hidden rounded-md border border-slate-200">
          <table className="w-full text-[13px] sm:text-sm">
            <thead className="bg-slate-100 text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">구분</th>
                <th className="px-4 py-3 text-right font-semibold">구좌수</th>
              </tr>
            </thead>
            <tbody className="bg-white text-slate-800">
              <tr className="border-t border-slate-200">
                <td className="px-4 py-3">개인 실적 구좌</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {personalUnitCount.toLocaleString('ko-KR')}
                </td>
              </tr>
              <tr className="border-t border-slate-200">
                <td className="px-4 py-3">산하 실적 구좌</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {downlineUnitCount.toLocaleString('ko-KR')}
                </td>
              </tr>
              <tr className="border-t-2 border-slate-300 font-bold text-slate-900">
                <td className="px-4 py-3">총 합계 구좌</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {totalUnitCount.toLocaleString('ko-KR')}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* 6. 지급 및 공제 내역 */}
      <section className="mt-8 sm:mt-10">
        <SectionHeading>지급 및 공제 내역</SectionHeading>
        <div className="mt-3 overflow-hidden rounded-md border border-slate-200">
          <table className="w-full text-[13px] sm:text-sm">
            <thead className="bg-slate-100 text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">항목</th>
                <th className="px-4 py-3 text-right font-semibold">금액 (원)</th>
                <th className="px-4 py-3 text-right font-semibold">비고</th>
              </tr>
            </thead>
            <tbody className="bg-white text-slate-800">
              <tr className="border-t border-slate-200">
                <td className="px-4 py-3">개인 수당</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatWon(personalCommission)}</td>
                <td className="px-4 py-3 text-right text-slate-400" />
              </tr>
              <tr className="border-t border-slate-200">
                <td className="px-4 py-3">오버라이드</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatWon(overrideAmount)}</td>
                <td className="px-4 py-3 text-right text-slate-400" />
              </tr>
              <tr className="border-t border-slate-200">
                <td className="px-4 py-3">성과 장려금/보너스</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatWon(bonusAmount)}</td>
                <td className="px-4 py-3 text-right text-slate-400" />
              </tr>
              {/* 사업소득세 행: 베이지 배경 + 오렌지/레드 텍스트 */}
              <tr className="border-t border-slate-200 bg-[#FFF8F1] text-[#EA5635]">
                <td className="px-4 py-3 font-medium">사업소득세 (3.30%)</td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">
                  - {formatWon(withholdingTax)}
                </td>
                <td className="px-4 py-3 text-right text-[12px] font-medium">공제액</td>
              </tr>
              <tr className="border-t-2 border-slate-300 font-bold text-slate-900">
                <td className="px-4 py-3">실지급액</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatWon(netPayment)}</td>
                <td className="px-4 py-3 text-right text-[12px] font-normal text-slate-500">
                  
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* 7. 하단 안내문 */}
      <div className="mt-10 border-t border-slate-200 pt-5 text-center">
        <p className="text-[11px] leading-relaxed text-slate-400 sm:text-xs">
          본 명세서는 TY Life Partners와의 계약에 근거해 작성되었습니다.
          <br />
          내역에 대한 문의는 관리팀으로 연락 바랍니다.
        </p>
      </div>
    </article>
  );
}
