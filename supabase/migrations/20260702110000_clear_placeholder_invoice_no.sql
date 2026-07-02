-- =========================================================
-- TY Life Dashboard
-- 2026-07-02
-- 송장번호 placeholder('-', '[-]', '- [-]' 등) → NULL 정리
-- =========================================================

-- 1) 기존 데이터 일괄 정리 (대시·공백·괄호만 있는 값)
UPDATE public.contracts
SET
  invoice_no = NULL,
  invoice_registered_at = NULL
WHERE invoice_no IS NOT NULL
  AND TRIM(invoice_no) ~ '^[-\s\[\]]+$';

-- 2) 정산 뷰: placeholder 송장번호 제외
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
  AND COALESCE(TRIM(c.invoice_no), '') <> ''
  AND TRIM(c.invoice_no) !~ '^[-\s\[\]]+$';

-- 3) KPI 함수: placeholder 송장번호 제외
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
          AND TRIM(c.invoice_no) !~ '^[-\s\[\]]+$'
        )
      )
  )
  SELECT
    COALESCE(SUM(unit_count), 0)::BIGINT AS total_join_units,
    COALESCE(SUM(CASE WHEN join_date BETWEEN p_start_date AND p_end_date THEN unit_count ELSE 0 END), 0)::BIGINT
      AS period_join_units
  FROM eligible;
$$;
