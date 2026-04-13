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
  created_at: string;
  updated_at: string;
}

export interface ContractInsert {
  contract_code: string;
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
