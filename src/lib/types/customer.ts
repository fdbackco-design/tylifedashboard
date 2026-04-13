export type Gender = 'M' | 'F';

export interface Customer {
  id: string;
  name: string;
  /** 주민번호 앞 6자리에서 파생. 원문 저장 금지 */
  birth_date: string; // ISO date: 'YYYY-MM-DD'
  /** 주민번호 7번째 자리 기반. 원문 저장 금지 */
  gender: Gender;
  /** 표시용 마스킹. 예: "901201-1******" */
  ssn_masked: string;
  phone: string;
  created_at: string;
  updated_at: string;
}

export interface CustomerInsert {
  name: string;
  birth_date: string;
  gender: Gender;
  ssn_masked: string;
  phone: string;
}

export interface CustomerUpdate extends Partial<CustomerInsert> {}

/** SSN 파싱 결과 (원문은 이 구조체에도 포함하지 않음) */
export interface ParsedSsn {
  birth_date: string; // 'YYYY-MM-DD'
  gender: Gender;
  ssn_masked: string; // '901201-1******'
}
