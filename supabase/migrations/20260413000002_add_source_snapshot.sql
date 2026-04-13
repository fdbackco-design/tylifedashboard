-- =========================================================
-- TY Life Dashboard - Add source_snapshot_json to contracts
-- 2026-04-13
-- =========================================================

-- 리스트 HTML에서 파싱한 원본 매핑값 저장 (감사·디버깅용)
-- 키: .list-tit 텍스트, 값: .list-cont 텍스트
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS source_snapshot_json JSONB;
