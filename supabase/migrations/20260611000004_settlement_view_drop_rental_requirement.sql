-- =========================================================
-- TY Life Dashboard
-- 2026-06-11
-- v_contract_settlement_base : 렌탈신청번호 요구 제거
--
-- 이전 정의(20260416000002):
--   (status = '가입')
--   OR (status <> '해약' AND rental_request_no 존재 AND invoice_no 존재)
--
-- 신규 정의 (해피콜 + 송장번호 기준으로 통합):
--   (status = '가입')
--   OR (status <> '해약' AND invoice_no 존재)
--
-- 해피콜 결과/일시 검증은 정산 계산 본체(monthly-calculate / settlement-eligibility-v2)에서
-- 정산월 단위로 수행한다. 본 뷰는 표시/대시보드/조직도 KPI 등의 "가입 인정 SSOT" 로 쓰인다.
-- 다른 컬럼 구조/이름은 동일하게 유지한다.
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
  AND c.status <> '취소'
  AND c.sales_member_id IS NOT NULL
  AND COALESCE(c.sales_link_status, 'linked') = 'linked'
  AND (
    c.status = '가입'
    OR (
      c.status <> '해약'
      AND COALESCE(TRIM(c.invoice_no), '') <> ''
    )
  );
