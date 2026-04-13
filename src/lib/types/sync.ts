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

/** POST /contract/list 요청 */
export interface TyLifeListRequest {
  page: number;
  row_per_page: number;
}

/**
 * POST /contract/list 응답 내 계약 아이템
 * TODO: 실제 API 응답 구조 확인 후 필드 확정 필요
 */
export interface TyLifeContractListItem {
  id: string;
  contract_code: string;
  customer_name: string;
  join_date: string;
  status: string;
  unit_count: number;
  sales_member_name: string;
  org_name: string;
  product_type: string;
  [key: string]: unknown; // 추가 필드 허용 (정규화 단계에서 처리)
}

/** POST /contract/list 응답 */
export interface TyLifeListResponse {
  data: TyLifeContractListItem[];
  total: number;
  page: number;
  row_per_page: number;
}

/**
 * GET /contract/{id} HTML 파싱 결과
 * TODO: 실제 HTML 구조 확인 후 필드 확정 필요
 */
export interface TyLifeContractDetail {
  contract_code: string;
  customer_name: string;
  ssn_raw: string; // 파싱 즉시 masking 처리 후 원문 폐기
  phone: string;
  rental_request_no: string | null;
  memo: string | null;
  join_date: string;
  product_type: string;
  item_name: string;
  watch_fit: string;
  unit_count: number;
  join_method: string;
  status: string;
  happy_call_at: string | null;
  is_cancelled: boolean;
  contractor_name: string | null;
  beneficiary_name: string | null;
  relationship_to_contractor: string | null;
  sales_member_name: string;
  sales_member_external_id: string;
  org_name: string;
  parent_org_name: string | null;
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
