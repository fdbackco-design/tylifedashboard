-- sequence_no UNIQUE 제약 제거
-- SERIAL에서 API 순번값으로 전환 시 기존값과 충돌 방지

ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_sequence_no_key;
