-- TY케어플랜은 별도 물품명이 없는 상품이다.
-- 과거 일반 상품 placeholder로 저장된 행을 상품 타입과 함께 바로잡는다.
UPDATE public.contracts
SET product_type = 'TY케어플랜'::product_type,
    item_name = '',
    updated_at = now()
WHERE trim(coalesce(source_snapshot_json ->> '상품명', '')) = 'TY케어플랜';
