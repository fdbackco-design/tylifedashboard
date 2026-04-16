-- organization_members에 고객 식별자(source_customer_id) 부여
-- 목표: "담당자 노드"와 "본사 직계약 고객 노드"가 같은 사람일 때 DB에서도 1개 row로 재사용 가능하게 함

ALTER TABLE organization_members
  ADD COLUMN IF NOT EXISTS source_customer_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_org_members_source_customer_id
  ON organization_members (source_customer_id)
  WHERE source_customer_id IS NOT NULL;

