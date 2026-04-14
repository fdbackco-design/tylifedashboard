export type SyncStatus = 'running' | 'completed' | 'failed';
export type LogLevel = 'info' | 'warn' | 'error';

export interface SyncRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: SyncStatus;
  total_fetched: number;
  total_created: number;
  total_updated: number;
  total_errors: number;
  triggered_by: string;
}

export interface SyncLog {
  id: string;
  run_id: string | null;
  level: LogLevel;
  message: string;
  context: Record<string, unknown> | null;
  created_at: string;
}

// ─────────────────────────────────────────────
// TY Life 외부 API 응답 타입
// ─────────────────────────────────────────────

/**
 * POST /contract/list 응답.
 * 실제 계약 데이터는 data.listHtml (HTML 문자열) 안에 있음.
 * TODO: 실제 API 응답 확인 후 totalCount 필드명 확정 필요
 */
export interface TyLifeListApiResponse {
  data: {
    listHtml: string;
    /** TODO: 실제 필드명 확인 필요 (totalCount / total_count / pageInfo.totalCount 등) */
    totalCount?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * listHtml에서 파싱한 계약 한 행.
 * .product-list-wrap > .product-list 단위.
 * 값이 없거나 "-" 이면 null.
 */
export interface ParsedListItem {
  /** 순번 (표시용 raw 문자열) */
  sequence_no_raw: string | null;
  /** 렌탈신청번호 or 메모 raw — 숫자 판별은 normalize 단계 */
  rental_or_memo: string | null;
  /** 송장번호/운송장번호 (있으면) */
  invoice_no: string | null;
  /** 고객명 */
  customer_name: string;
  /** 주민번호 마스킹값 (예: "901201-1******") */
  ssn_masked: string;
  /** 계약 코드 (<a> 태그에서 추출) */
  contract_code: string;
  /** 소속 */
  affiliation_name: string | null;
  /** 담당자명 */
  sales_member_name: string | null;
  /** 상품명 raw */
  product_type_raw: string | null;
  /** 연락처 */
  phone: string | null;
  /** 가입 상태 raw */
  status_raw: string | null;
  /** 가입일 raw */
  joined_at_raw: string | null;
  /** 취소/반품 여부 */
  is_cancelled: boolean;
  /** 해피콜 일시 raw */
  happycall_at_raw: string | null;
  /** 해피콜 결과 */
  happycall_result: string | null;
  /** 가입 방법 raw */
  join_method_raw: string | null;
  /** 워치/핏 raw */
  watch_fit_raw: string | null;
  /** goDetail(N) 에서 추출한 TY Life 내부 ID */
  external_id: string | null;
  /** 원본 셀 매핑값 — source_snapshot_json 저장용 (키: list-tit, 값: list-cont) */
  _snapshot: Record<string, string | null>;
}

/**
 * GET /contract/{id} HTML 파싱 결과.
 * 리스트에 없는 필드를 보강하는 용도.
 * TODO: 실제 HTML 구조 확인 후 셀렉터/필드명 확정 필요
 */
export interface TyLifeContractDetail {
  contract_code: string;
  /** 물품명 (상세에서만 확인 가능) */
  item_name: string | null;
  /** 가입 구좌 수 (상세에서만 확인 가능) */
  unit_count: number | null;
  /** 계약자와의 관계 */
  relationship_to_contractor: string | null;
  /** 계약자명 */
  contractor_name: string | null;
  /** 지정인(수혜자)명 */
  beneficiary_name: string | null;
  /** 담당 사원 TY Life 내부 ID (조직원 dedup 기준) */
  sales_member_external_id: string | null;
  /** 상위 소속 라인(레그) */
  parent_org_name: string | null;
  /**
   * SSN 원문 — 파싱 직후 normalize() 에서 masking 처리 후 폐기.
   * 로그 출력·DB 저장 절대 금지.
   * TODO: 상세 페이지에서 SSN이 노출되는지 확인 필요
   */
  ssn_raw: string | null;
}

/** sync-service 처리 결과 */
export interface SyncResult {
  run_id: string;
  status: SyncStatus;
  total_fetched: number;
  total_created: number;
  total_updated: number;
  total_errors: number;
  duration_ms: number;
}

/** runSync 옵션 */
export interface SyncOptions {
  triggeredBy?: string;
  rowPerPage?: number;
  /** 최대 수집 페이지 수 (미설정 시 전체) */
  maxPage?: number;
  /** true 이면 DB 저장 없이 파싱 결과만 반환 */
  dryRun?: boolean;
}
