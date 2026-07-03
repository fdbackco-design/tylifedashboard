-- =========================================================
-- TY Life Dashboard
-- 2026-07-03
-- TY갤럭시케어_무: 송장 없이 해피콜 완료만으로 정산 뷰 가입 인정
-- =========================================================

CREATE OR REPLACE VIEW v_contract_settlement_base AS
SELECT
  c.id                  AS contract_id,
  c.contract_code,
  c.join_date,
  CASE
    WHEN EXTRACT(DAY FROM c.join_date) >= 26
      THEN TO_CHAR((DATE_TRUNC('month', c.join_date)::date + INTERVAL '1 month')::date, 'YYYY-MM')
    ELSE TO_CHAR(DATE_TRUNC('month', c.join_date)::date, 'YYYY-MM')
  END AS year_month,
  c.unit_count,
  c.status,
  c.is_cancelled,
  c.sales_member_id,
  om.name               AS sales_member_name,
  om.rank               AS sales_member_rank
FROM contracts c
LEFT JOIN organization_members om ON om.id = c.sales_member_id
WHERE
  c.is_cancelled = FALSE
  AND c.status::text NOT IN ('취소', '해약', '계약취소')
  AND c.sales_member_id IS NOT NULL
  AND COALESCE(c.sales_link_status, 'linked') = 'linked'
  AND c.happycall_result IN ('성공', '완료', '심사완료', '계약변경')
  AND (
    (
      COALESCE(TRIM(c.invoice_no), '') <> ''
      AND TRIM(c.invoice_no) !~ '^[-\s\[\]]+$'
    )
    OR (
      (
        c.product_type::text = '무'
        OR COALESCE(c.source_snapshot_json->>'상품명', '') LIKE '%TY갤럭시케어_무%'
        OR COALESCE(c.source_snapshot_json->>'상품명', '') LIKE '%\_무'
      )
      AND c.happy_call_at IS NOT NULL
    )
  );
