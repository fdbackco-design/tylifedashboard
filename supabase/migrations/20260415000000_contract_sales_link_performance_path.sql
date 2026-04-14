-- 계약: 담당자 연결 상태 + 실적 경로(수집 시점 스냅샷)
-- sales_link_status = pending_mapping 인 계약은 정산/실적 집계에서 제외

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS sales_link_status TEXT NOT NULL DEFAULT 'linked'
    CHECK (sales_link_status IN ('linked', 'pending_mapping')),
  ADD COLUMN IF NOT EXISTS raw_sales_member_name TEXT,
  ADD COLUMN IF NOT EXISTS performance_path_json JSONB;

COMMENT ON COLUMN contracts.sales_link_status IS 'linked: 담당자 확정, pending_mapping: 동명이인/미매칭으로 관리자 매핑 대기';
COMMENT ON COLUMN contracts.raw_sales_member_name IS '수집 원본 담당자명 (매핑 대기 시 표시)';
COMMENT ON COLUMN contracts.performance_path_json IS '수집 시점 상위 조직 경로 스냅샷 JSON [{id,name,rank}, ...] 루트→담당자';

CREATE INDEX IF NOT EXISTS idx_contracts_sales_link_pending
  ON contracts (sales_link_status)
  WHERE sales_link_status = 'pending_mapping';

-- 정산 뷰: 담당 미확인 계약 제외 (실적 반영 안 함)
CREATE OR REPLACE VIEW v_contract_settlement_base AS
SELECT
  c.id                  AS contract_id,
  c.contract_code,
  c.join_date,
  TO_CHAR(c.join_date, 'YYYY-MM') AS year_month,
  c.unit_count,
  c.status,
  c.is_cancelled,
  c.sales_member_id,
  om.name               AS sales_member_name,
  om.rank               AS sales_member_rank
FROM contracts c
LEFT JOIN organization_members om ON om.id = c.sales_member_id
WHERE
  c.status NOT IN ('취소', '해약')
  AND c.is_cancelled = FALSE
  AND c.sales_member_id IS NOT NULL
  AND c.sales_link_status = 'linked';
