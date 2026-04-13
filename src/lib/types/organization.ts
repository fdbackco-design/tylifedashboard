export type RankType =
  | '영업사원'
  | '리더'
  | '센터장'
  | '사업본부장'
  | '본사';

/** 직급 계층 순서 (index 낮을수록 하위 직급) */
export const RANK_ORDER: readonly RankType[] = [
  '영업사원',
  '리더',
  '센터장',
  '사업본부장',
  '본사',
] as const;

export interface OrganizationMember {
  id: string;
  name: string;
  rank: RankType;
  phone: string | null;
  email: string | null;
  /** TY Life 시스템 내부 ID. upsert 기준 키 */
  external_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrganizationMemberInsert {
  name: string;
  rank: RankType;
  phone?: string | null;
  email?: string | null;
  external_id?: string | null;
  is_active?: boolean;
}

export interface OrganizationEdge {
  id: string;
  parent_id: string | null;
  child_id: string;
}

export interface OrganizationEdgeInsert {
  parent_id: string | null;
  child_id: string;
}

/** 조직 트리 노드 (재귀 구조) */
export interface OrgTreeNode extends OrganizationMember {
  children: OrgTreeNode[];
}

/** DB get_org_tree 함수 반환 행 */
export interface OrgTreeRow {
  id: string;
  name: string;
  rank: RankType;
  parent_id: string | null;
  depth: number;
}
