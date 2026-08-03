/**
 * 정산/조직 KPI 대상 계약(SSOT).
 *
 * 본 함수는 화면 카운트(조직도/누적 구좌/명세서 표시 등)에서 사용되는 "정적" 가입 인정 helper.
 * - 정산월(yearMonth) 단위의 시간 의존 판정(해피콜 윈도우/송장 마감일/이월 등)은
 *   `evaluateContractEligibility` (settlement-eligibility-v2) 가 담당한다.
 * - 화면 카운트는 yearMonth 가 명확하지 않거나 누적/전체 기간을 보는 케이스가 많아서
 *   v2 의 yearMonth 독립 핵심 조건(=`isV2EligibleStatic`) 만으로 가입 인정 여부를 판정한다.
 *
 * 통과 조건 (v2 정적 기준):
 *   1) is_cancelled / status('취소'·'해약'·'계약취소') 아님
 *   2) sales_member_id 존재 & sales_link_status == 'linked'
 *   3) happycall_result ∈ { '성공', '완료', '심사완료', '계약변경' }
 *      (또는 TY갤럭시케어_무 · TY케어플랜은 해피콜 일시+결과만)
 *   4) invoice_no 존재 (TY갤럭시케어_무 · TY케어플랜 제외)
 *
 * NOTE:
 * - `rental_request_no` 필드는 호환을 위해 인터페이스에 남겨두지만 판단에는 사용하지 않는다.
 * - 정산 본체(`monthly-calculate`)는 본 helper 를 거치지 않고 `evaluateContractEligibility`
 *   로 yearMonth 별 ELIGIBLE/DEFERRED/EXCLUDED 를 직접 판정한다.
 */
import { isV2EligibleStatic } from './settlement-eligibility-v2';

export function isSettlementEligibleContract(c: {
  status: string;
  is_cancelled?: boolean | null;
  sales_member_id?: string | null;
  sales_link_status?: string | null;
  rental_request_no?: string | null;
  happy_call_at?: unknown;
  happycall_result?: string | null;
  product_type?: string | null;
  item_name?: string | null;
  source_snapshot_json?: Record<string, string | null> | null;
  invoice_no?: string | null;
}): boolean {
  return isV2EligibleStatic(c);
}
