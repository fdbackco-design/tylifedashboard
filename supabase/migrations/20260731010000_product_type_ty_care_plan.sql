-- TY 동기화 원본 상품명 'TY케어플랜'을 일반으로 축약하지 않고 별도 보존한다.
ALTER TYPE product_type ADD VALUE IF NOT EXISTS 'TY케어플랜';
