export type ContractStatus =
  | '준비'
  | '대기'
  | '상담중'
  | '가입'
  | '해피콜완료'
  | '배송준비'
  | '배송완료'
  | '정산완료'
  | '취소'
  | '해약';

export type ProductType = 'TY갤럭시케어' | '무' | '일반';

export type WatchFitType = '갤럭시워치' | '갤럭시핏' | '해당없음';

export type JoinMethodType = '해피콜' | '간편가입' | '기타';

/** 담당자 연결: linked만 정산·실적 집계, pending_mapping은 관리자 매핑 대기 */
export type SalesLinkStatus = 'linked' | 'pending_mapping';

/** 수집 시점 상위 조직 경로 스냅샷 (루트 → 담당자) */
export interface PerformancePathSegment {
  id: string;
  name: string;
  rank: string;
}

export interface Contract {
  id: string;
  /** 리스트 표시용 순번 */
  sequence_no: number;
  /** 고유 계약 식별 코드 */
  contract_code: string;
  /** 렌탈신청번호 (숫자 판별 시) */
  rental_request_no: string | null;
  /** 메모 (숫자 아닌 경우) */
  memo: string | null;
  customer_id: string;
  sales_member_id: string | null;
  join_date: string; // 'YYYY-MM-DD'
  product_type: ProductType;
  item_name: string;
  watch_fit: WatchFitType;
  /** 가입 구좌 수. 정산 핵심값 */
  unit_count: number;
  join_method: JoinMethodType;
  status: ContractStatus;
  happy_call_at: string | null;
  /** true이면 당월 정산 제외 */
  is_cancelled: boolean;
  contractor_name: string | null;
  beneficiary_name: string | null;
  relationship_to_contractor: string | null;
  external_id: string | null;
  /** 소속명 (list HTML에서 추출) */
  affiliation_name: string | null;
  /** 해피콜 결과 (list HTML에서 추출) */
  happycall_result: string | null;
  /** 리스트 HTML 원본 셀 매핑값 (감사용) */
  source_snapshot_json: Record<string, string | null> | null;
  sales_link_status?: SalesLinkStatus;
  /** 매핑 대기 시 TY Life에서 온 담당자명 */
  raw_sales_member_name?: string | null;
  /** 수집 시점 조직 상위 경로 (퇴사·이동 후에도 당시 실적 레그 보존) */
  performance_path_json?: PerformancePathSegment[] | null;
  created_at: string;
  updated_at: string;
}

export interface ContractInsert {
  contract_code: string;
  sequence_no?: number | null;
  rental_request_no?: string | null;
  memo?: string | null;
  customer_id: string;
  sales_member_id?: string | null;
  join_date: string;
  product_type: ProductType;
  item_name?: string;
  watch_fit?: WatchFitType;
  unit_count: number;
  join_method: JoinMethodType;
  status?: ContractStatus;
  happy_call_at?: string | null;
  is_cancelled?: boolean;
  contractor_name?: string | null;
  beneficiary_name?: string | null;
  relationship_to_contractor?: string | null;
  external_id?: string | null;
  affiliation_name?: string | null;
  happycall_result?: string | null;
  raw_data?: Record<string, unknown>;
  /** 리스트 HTML에서 파싱한 원본 셀 매핑값 (키: list-tit, 값: list-cont) */
  source_snapshot_json?: Record<string, string | null> | null;
  sales_link_status?: SalesLinkStatus;
  raw_sales_member_name?: string | null;
  performance_path_json?: PerformancePathSegment[] | null;
}

export interface ContractUpdate extends Partial<ContractInsert> {}

export interface ContractStatusHistory {
  id: string;
  contract_id: string;
  from_status: ContractStatus | null;
  to_status: ContractStatus;
  changed_at: string;
  changed_by: string;
  note: string | null;
}

/** 계약 리스트 행 (JOIN 포함) */
export interface ContractListRow extends Contract {
  customer_name: string;
  sales_member_name: string | null;
  org_name: string | null; // 소속(1차)
}
