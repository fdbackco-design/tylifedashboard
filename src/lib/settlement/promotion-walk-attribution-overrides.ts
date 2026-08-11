/**
 * 승급/누적 구좌(walk) 전용 계약 귀속 override.
 *
 * - `joinAttributed.sales_member_id` 에만 적용한다.
 * - `contracts.settlement_sales_member_id` / `sales_member_id` / organization_edges 는 변경하지 않는다.
 * - 직접수당·롤업 수당 소유자(월정산 effective sales)에는 영향 없다.
 */

/** contract_code → 누적 walk 귀속 대상 멤버 이름(organization_members.name) */
export const PROMOTION_WALK_MEMBER_NAME_BY_CONTRACT_CODE: Readonly<Record<string, string>> = {
  // 김중권 자기구매 2건: 노드·정산담당은 유지하고 누적 구좌만 임혜진에 합산
  TY15220260519: '임혜진',
  TY15320260519: '임혜진',
};

export function buildMemberIdByNameMap(
  members: ReadonlyArray<{ id: string; name?: string | null }>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of members) {
    const id = String(m.id ?? '').trim();
    if (!id) continue;
    const raw = String(m.name ?? '').replace(/^\[고객\]\s*/, '').trim();
    if (!raw) continue;
    if (!out.has(raw)) out.set(raw, id);
  }
  return out;
}

/**
 * walk 귀속 ID에 계약 코드 override를 적용한다.
 * override 대상이 없거나 멤버를 못 찾으면 attributedMemberId 그대로 반환.
 */
export function applyPromotionWalkSalesMemberOverride(args: {
  contract_code?: string | null;
  attributedMemberId: string;
  memberIdByName: ReadonlyMap<string, string>;
}): string {
  const code = String(args.contract_code ?? '').trim();
  if (!code) return args.attributedMemberId;
  const targetName = PROMOTION_WALK_MEMBER_NAME_BY_CONTRACT_CODE[code];
  if (!targetName) return args.attributedMemberId;
  const targetId = args.memberIdByName.get(targetName);
  if (!targetId) return args.attributedMemberId;
  return targetId;
}
