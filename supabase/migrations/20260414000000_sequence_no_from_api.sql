-- sequence_no를 자동증가(SERIAL)에서 TY Life API 순번값으로 변경
-- SERIAL 기본값과 UNIQUE 제약 제거 후 nullable INTEGER로 전환

ALTER TABLE contracts
  ALTER COLUMN sequence_no DROP DEFAULT,
  ALTER COLUMN sequence_no DROP NOT NULL,
  ALTER COLUMN sequence_no TYPE INTEGER;

-- 기존 SERIAL 시퀀스 오브젝트 제거
DROP SEQUENCE IF EXISTS contracts_sequence_no_seq;
