-- 상품별 본사 매출 단가 판별을 위해 product_type enum 확장
-- (동기화 시 normalizeProductType 이 원문 상품명을 보존하도록 매핑)

ALTER TYPE product_type ADD VALUE IF NOT EXISTS '올라이프케어';
ALTER TYPE product_type ADD VALUE IF NOT EXISTS '스페셜라이프케어';
ALTER TYPE product_type ADD VALUE IF NOT EXISTS '갤럭시케어 라이트';
