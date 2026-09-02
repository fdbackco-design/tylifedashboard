-- TY올라이프케어_무 가 generic '_무' 규칙 때문에 product_type=무(갤럭시무)로 저장되던 행을 보정한다.
-- 화면·정산·본사매출에서 TY올라이프케어와 동일하게 취급한다.

UPDATE public.contracts
SET product_type = 'TY올라이프케어'::product_type,
    updated_at = now()
WHERE product_type IS DISTINCT FROM 'TY올라이프케어'::product_type
  AND trim(coalesce(source_snapshot_json ->> '상품명', '')) ILIKE '%올라이프케어%';

-- 정산 뷰: generic '%_무' 는 올라이프케어_무 까지 갤럭시무 송장면제로 넣으므로,
-- TY갤럭시케어_무 / product_type=무 만 면제하고 올라이프케어 스냅샷은 제외한다.
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
      COALESCE(c.source_snapshot_json->>'상품명', '') NOT ILIKE '%올라이프케어%'
      AND c.product_type::text NOT IN ('TY올라이프케어', '올라이프케어')
      AND (
        c.product_type::text = '무'
        OR COALESCE(c.source_snapshot_json->>'상품명', '') LIKE '%TY갤럭시케어_무%'
      )
      AND c.happy_call_at IS NOT NULL
    )
  );
