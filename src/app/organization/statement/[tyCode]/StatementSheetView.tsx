/**
 * 영업자별 지급명세서 표시 컴포넌트 (PDF 디자인 참고).
 *
 * 디자인 형식:
 *   - 상단: TY Life Partners 로고/타이틀, "지급 명세서" 제목
 *   - 기본 정보: 성명 / 직책 / 정산월 / 정산기간
 *   - 이번 달 실지급액 강조 영역
 *   - 실적 요약 (개인 / 산하 / 총 합계 구좌)
 *   - 지급 및 공제 내역 (개인 수당 / 오버라이드 / 성과 장려금/보너스 / 사업소득세 / 실지급액)
 *   - 하단 안내문
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
    <div className="mx-auto w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <TyLifePartnersLogo className="shrink-0" mobileSrc="/logo.png" />
        <h1 className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">지급 명세서</h1>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px] text-slate-700 sm:text-sm">
        <div className="flex gap-2">
          <dt className="shrink-0 text-slate-500">성명</dt>
          <dd className="font-semibold text-slate-900">{name}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-slate-500">직책</dt>
          <dd className="font-semibold text-slate-900">{rank}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-slate-500">정산 월</dt>
          <dd className="font-semibold tabular-nums text-slate-900">{yearMonthLabelKo}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-slate-500">정산 기간</dt>
          <dd className="font-semibold tabular-nums text-slate-900">{displayWindowKo}</dd>
        </div>
      </dl>

      <div className="mt-5 rounded-xl border border-orange-200/80 bg-gradient-to-br from-orange-50 to-amber-50 p-4 text-center shadow-inner ring-1 ring-orange-100/70 sm:p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-700 sm:text-xs">
          이번 달 실지급액
        </p>
        <p className="mt-1.5 text-3xl font-extrabold tabular-nums tracking-tight text-orange-900 sm:text-4xl">
          {formatWon(netPayment)}
          <span className="ml-1 text-base font-semibold text-orange-700 sm:text-lg">원</span>
        </p>
      </div>

      <section className="mt-6">
        <h2 className="text-[13px] font-semibold text-slate-800 sm:text-sm">실적 요약</h2>
        <table className="mt-2 w-full text-[12px] sm:text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-2 text-left font-medium">구분</th>
              <th className="py-2 text-right font-medium">구좌수</th>
            </tr>
          </thead>
          <tbody className="text-slate-800">
            <tr className="border-b border-slate-100">
              <td className="py-2">개인 실적 구좌</td>
              <td className="py-2 text-right tabular-nums">{personalUnitCount.toLocaleString('ko-KR')}</td>
            </tr>
            <tr className="border-b border-slate-100">
              <td className="py-2">산하 실적 구좌</td>
              <td className="py-2 text-right tabular-nums">{downlineUnitCount.toLocaleString('ko-KR')}</td>
            </tr>
            <tr className="border-t border-slate-300 font-semibold">
              <td className="py-2">총 합계 구좌</td>
              <td className="py-2 text-right tabular-nums">{totalUnitCount.toLocaleString('ko-KR')}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="mt-6">
        <h2 className="text-[13px] font-semibold text-slate-800 sm:text-sm">지급 및 공제 내역</h2>
        <table className="mt-2 w-full text-[12px] sm:text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-2 text-left font-medium">항목</th>
              <th className="py-2 text-right font-medium">금액 (원)</th>
              <th className="py-2 text-right font-medium">비고</th>
            </tr>
          </thead>
          <tbody className="text-slate-800">
            <tr className="border-b border-slate-100">
              <td className="py-2">개인 수당</td>
              <td className="py-2 text-right tabular-nums">{formatWon(personalCommission)}</td>
              <td className="py-2 text-right text-slate-400" />
            </tr>
            <tr className="border-b border-slate-100">
              <td className="py-2">오버라이드</td>
              <td className="py-2 text-right tabular-nums">{formatWon(overrideAmount)}</td>
              <td className="py-2 text-right text-slate-400" />
            </tr>
            <tr className="border-b border-slate-100">
              <td className="py-2">성과 장려금/보너스</td>
              <td className="py-2 text-right tabular-nums">{formatWon(bonusAmount)}</td>
              <td className="py-2 text-right text-slate-400" />
            </tr>
            <tr className="border-b border-slate-100">
              <td className="py-2">사업소득세 (3.30%)</td>
              <td className="py-2 text-right tabular-nums text-rose-600">
                -{formatWon(withholdingTax)}
              </td>
              <td className="py-2 text-right text-[11px] text-slate-500">공제액</td>
            </tr>
            <tr className="border-t border-slate-300 text-base font-bold text-slate-900">
              <td className="py-2.5">실지급액</td>
              <td className="py-2.5 text-right tabular-nums">{formatWon(netPayment)}</td>
              <td className="py-2.5 text-right text-[11px] text-slate-400">총 지급</td>
            </tr>
          </tbody>
        </table>
      </section>

      <footer className="mt-6 border-t border-dashed border-slate-200 pt-4 text-[11px] leading-relaxed text-slate-500">
        본 명세서는 TY Life Partners와의 파트너십 계약에 근거하여 작성되었습니다.
        <br />
        내역에 대한 문의는 관리팀으로 연락 바랍니다.
      </footer>
    </div>
  );
}
