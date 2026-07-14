-- TY 동기화: 원본 상품명 '스페셜라이프케어' 등이 product_type enum 에 없어 upsert 실패하던 문제 수정.
-- 본사 매출 단가 분류명과 동일하게 'TY스페셜라이프케어' 를 canonical 값으로 추가한다.
-- (레거시 '일반가전'·중간값 '스페셜라이프케어' 도 허용해 기존/혼재 데이터와 동기화 모두 안전하게)

ALTER TYPE product_type ADD VALUE IF NOT EXISTS 'TY스페셜라이프케어';
ALTER TYPE product_type ADD VALUE IF NOT EXISTS '스페셜라이프케어';
