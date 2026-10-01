-- 기존 TY케어플랜 계약이 product_type=일반으로 남은 데이터를 보정한다.
-- 이후 신규 계약은 normalizeProductType 및 케어플랜 상태 전용 동기화가 동일하게 보정한다.
UPDATE public.contracts
SET
  product_type = 'TY케어플랜'::product_type,
  item_name = '',
  updated_at = now()
WHERE product_type IS DISTINCT FROM 'TY케어플랜'::product_type
  AND (
    coalesce(source_snapshot_json ->> '상품명', '') ILIKE '%TY케어플랜%'
    OR coalesce(item_name, '') ILIKE '%TY케어플랜%'
  );
