-- =========================================================
-- TY Life Dashboard
-- 2026-06-11
-- v_contract_settlement_base : 정산 v2 정적 가입 인정 기준으로 통합
--
-- 이전 정의(20260416000002):
--   (status = '가입')
--   OR (status <> '해약' AND rental_request_no 존재 AND invoice_no 존재)
--
-- 신규 정의 (정산 v2 "정적" 기준 — yearMonth 비의존):
--   1) is_cancelled = FALSE
--   2) status NOT IN ('취소', '해약', '계약취소')
--   3) sales_member_id IS NOT NULL
--   4) sales_link_status = 'linked'
--   5) happycall_result ∈ ('성공', '완료', '심사완료', '계약변경')
--   6) invoice_no 가 존재(TRIM 후 비어있지 않음)
--
-- 정산월 단위의 시간 의존 조건(해피콜 윈도우/송장 마감일/이월 등)은 정산 본체
-- (`monthly-calculate.ts` / `settlement-eligibility-v2.ts`) 가 수행한다.
-- 본 뷰는 화면/조직도/대시보드 KPI 의 "가입 인정 SSOT" 로 사용된다.
--
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
  -- contract_status enum 에는 '계약취소' 값이 없지만, 향후 enum 변경/외부 데이터 유입 시에도
  -- v2 정적 기준과 동일하게 동작하도록 ::text 캐스팅으로 비교한다.
  AND c.status::text NOT IN ('취소', '해약', '계약취소')
  AND c.sales_member_id IS NOT NULL
  AND COALESCE(c.sales_link_status, 'linked') = 'linked'
  AND c.happycall_result IN ('성공', '완료', '심사완료', '계약변경')
  AND COALESCE(TRIM(c.invoice_no), '') <> '';
