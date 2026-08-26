-- TY 동기화: 원본 상품명 'TY올라이프케어' 가 product_type enum 에 없어 upsert 실패하던 문제 수정.
-- 다른 TY 상품(TY갤럭시케어/TY케어플랜/TY스페셜라이프케어)과 같이 'TY올라이프케어' 를 canonical 값으로 추가한다.
-- 레거시 '올라이프케어' 는 기존 행·혼재 데이터를 위해 유지한다.

ALTER TYPE product_type ADD VALUE IF NOT EXISTS 'TY올라이프케어';
ALTER TYPE product_type ADD VALUE IF NOT EXISTS '올라이프케어';
