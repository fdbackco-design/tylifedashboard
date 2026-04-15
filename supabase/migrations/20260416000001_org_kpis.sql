-- =========================================================
-- TY Life Dashboard - Organization KPI aggregates
-- 2026-04-16
-- =========================================================

/**
 * 가입 인정 기준(프로젝트 공통):
 * - status = '가입'
 *   OR (status != '해약' AND rental_request_no + invoice_no 존재)
 *
 * 정산/조직 KPI 기준 정렬:
 * - is_cancelled = false
 * - status != '취소'
 * - sales_member_id IS NOT NULL
 * - sales_link_status = 'linked' (담당 미확인 제외)
 */

CREATE OR REPLACE FUNCTION get_organization_kpis(
  p_start_date DATE,
  p_end_date   DATE
)
RETURNS TABLE (
  total_join_units  BIGINT,
  period_join_units BIGINT
)
LANGUAGE SQL
STABLE
AS $$
  WITH eligible AS (
    SELECT
      c.join_date,
      c.unit_count
    FROM contracts c
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
      )
  )
  SELECT
    COALESCE(SUM(unit_count), 0)::BIGINT AS total_join_units,
    COALESCE(SUM(CASE WHEN join_date BETWEEN p_start_date AND p_end_date THEN unit_count ELSE 0 END), 0)::BIGINT
      AS period_join_units
  FROM eligible;
$$;

