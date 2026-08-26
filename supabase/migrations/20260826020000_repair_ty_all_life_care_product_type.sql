-- 스냅샷 상품명/기존 product_type 이 올라이프케어인데 canonical 이 아닌 행을 보정한다.
-- (enum 추가 이후 sync가 보정되기 전에 저장된 레거시 데이터)

UPDATE public.contracts
SET product_type = 'TY올라이프케어'::product_type,
    updated_at = now()
WHERE product_type IS DISTINCT FROM 'TY올라이프케어'::product_type
  AND (
    product_type::text = '올라이프케어'
    OR trim(coalesce(source_snapshot_json ->> '상품명', '')) ILIKE '%올라이프케어%'
  );
