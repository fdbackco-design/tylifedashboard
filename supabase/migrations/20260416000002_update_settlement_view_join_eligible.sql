-- =========================================================
-- TY Life Dashboard - Settlement eligible view (join-based)
-- 2026-04-16
-- =========================================================

/**
 * 정산/조직 KPI 대상(SSOT: join 인정 기준)
 * - is_cancelled = false
 * - status <> '취소'
 * - sales_member_id IS NOT NULL
 * - sales_link_status = 'linked' (담당 미확인 제외)
 * - status = '가입'
 *   OR (status <> '해약' AND rental_request_no + invoice_no 존재)
 */

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
  c.is_cancelled = FALSE
  AND c.status <> '취소'
  AND c.sales_member_id IS NOT NULL
  AND COALESCE(c.sales_link_status, 'linked') = 'linked'
  AND (
    c.status = '가입'
    OR (
      c.status <> '해약'
      AND COALESCE(TRIM(c.rental_request_no), '') <> ''
      AND COALESCE(TRIM(c.invoice_no), '') <> ''
    )
  );

