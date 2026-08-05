-- 스냅샷 상품명이 TY케어플랜인데 product_type이 일반으로 남은 행을 보정한다.
-- (enum 추가 이후 sync가 보정되기 전에 저장된 레거시 데이터)
UPDATE public.contracts
SET product_type = 'TY케어플랜'::product_type,
    item_name = '',
    updated_at = now()
WHERE trim(coalesce(source_snapshot_json ->> '상품명', '')) = 'TY케어플랜'
  AND product_type IS DISTINCT FROM 'TY케어플랜'::product_type;
