/**
 * 고객 노드에 계약을 이중 부착할 때, 담당자별로 나눠 보이게 할 고객.
 * (동일 고객·다른 담당자 계약이 한 parent 노드에 몰리는 케이스 한정)
 *
 * 조직도 표시와 정산 승급 walk 귀속이 동일 규칙을 쓰도록 공유한다.
 */
export const ORG_CUSTOMER_NODE_SPLIT_BY_SALES_PARENT_IDS: ReadonlySet<string> = new Set([
  'f21273ec-f980-4ac0-b16c-bf6ae4e7a606', // 정성훈
  '35f23c0b-bde8-4166-83ff-19eb7e027bb7', // 홍진운 (임태순/정철희 담당 분리)
]);
