-- =========================================================
-- TY Life Dashboard - Initial Schema Migration
-- 2026-04-13
-- =========================================================

-- ─────────────────────────────────────────────────────────
-- ENUM 타입 정의
-- ─────────────────────────────────────────────────────────

CREATE TYPE rank_type AS ENUM (
  '영업사원',
  '리더',
  '센터장',
  '사업본부장',
  '본사'
);

CREATE TYPE contract_status AS ENUM (
  '준비',
  '대기',
  '상담중',
  '가입',
  '해피콜완료',
  '배송준비',
  '배송완료',
  '정산완료',
  '취소',
  '해약'
);

CREATE TYPE product_type AS ENUM (
  'TY갤럭시케어',
  '무',
  '일반'
);

CREATE TYPE watch_fit_type AS ENUM (
  '갤럭시워치',
  '갤럭시핏',
  '해당없음'
);

CREATE TYPE join_method_type AS ENUM (
  '해피콜',
  '간편가입',
  '기타'
);

CREATE TYPE sync_status AS ENUM (
  'running',
  'completed',
  'failed'
);

CREATE TYPE log_level AS ENUM (
  'info',
  'warn',
  'error'
);

-- ─────────────────────────────────────────────────────────
-- customers
-- 고객 기본정보. SSN 원문 저장 금지.
-- ─────────────────────────────────────────────────────────

CREATE TABLE customers (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL,
  -- 주민번호 앞 6자리에서 파생 (원문 저장 금지)
  birth_date    DATE        NOT NULL,
  gender        CHAR(1)     NOT NULL CHECK (gender IN ('M', 'F')),
  -- 표시용 마스킹값만 저장 예: "901201-1******"
  ssn_masked    TEXT        NOT NULL,
  phone         TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customers_ssn_masked ON customers (ssn_masked);
CREATE INDEX idx_customers_name ON customers (name);

-- ─────────────────────────────────────────────────────────
-- organization_members
-- 영업 조직원. 직급 포함.
-- ─────────────────────────────────────────────────────────

CREATE TABLE organization_members (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL,
  rank          rank_type   NOT NULL,
  phone         TEXT,
  email         TEXT,
  -- TY Life 시스템 내부 ID (upsert 기준 키)
  external_id   TEXT        UNIQUE,
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_org_members_rank ON organization_members (rank);
CREATE INDEX idx_org_members_active ON organization_members (is_active);

-- ─────────────────────────────────────────────────────────
-- organization_edges
-- 조직 계층 adjacency list.
-- child_id UNIQUE → 각 멤버는 부모가 최대 1명.
-- parent_id NULL → 최상위 (본사 등)
-- ─────────────────────────────────────────────────────────

CREATE TABLE organization_edges (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id     UUID        REFERENCES organization_members (id) ON DELETE SET NULL,
  child_id      UUID        NOT NULL UNIQUE REFERENCES organization_members (id) ON DELETE CASCADE
);

CREATE INDEX idx_org_edges_parent ON organization_edges (parent_id);

-- ─────────────────────────────────────────────────────────
-- contracts
-- 핵심 계약 단위.
-- ─────────────────────────────────────────────────────────

CREATE TABLE contracts (
  id                        UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 리스트 표시용 순번 (자동 증가)
  sequence_no               SERIAL            UNIQUE NOT NULL,
  -- 고유 계약 식별 코드 (TY Life 기준)
  contract_code             TEXT              UNIQUE NOT NULL,
  -- 렌탈신청번호 (숫자인 경우), 메모 (숫자가 아닌 경우)
  rental_request_no         TEXT,
  memo                      TEXT,
  customer_id               UUID              NOT NULL REFERENCES customers (id),
  sales_member_id           UUID              REFERENCES organization_members (id) ON DELETE SET NULL,
  join_date                 DATE              NOT NULL,
  product_type              product_type      NOT NULL,
  item_name                 TEXT              NOT NULL DEFAULT '헬스365 고주파 발마사지기 [Health365]',
  watch_fit                 watch_fit_type    NOT NULL DEFAULT '해당없음',
  -- 가입 구좌 수: 정산 핵심값
  unit_count                INTEGER           NOT NULL CHECK (unit_count > 0),
  join_method               join_method_type  NOT NULL,
  status                    contract_status   NOT NULL DEFAULT '준비',
  happy_call_at             TIMESTAMPTZ,
  -- true이면 당월 정산에서 제외
  is_cancelled              BOOLEAN           NOT NULL DEFAULT FALSE,
  contractor_name           TEXT,
  beneficiary_name          TEXT,
  relationship_to_contractor TEXT,
  -- TY Life 시스템 내부 ID (upsert 기준)
  external_id               TEXT              UNIQUE,
  -- 원본 응답 (감사/디버깅용, 민감정보 포함 시 주의)
  raw_data                  JSONB,
  created_at                TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_contracts_customer ON contracts (customer_id);
CREATE INDEX idx_contracts_sales_member ON contracts (sales_member_id);
CREATE INDEX idx_contracts_status ON contracts (status);
CREATE INDEX idx_contracts_join_date ON contracts (join_date);
CREATE INDEX idx_contracts_is_cancelled ON contracts (is_cancelled);
CREATE INDEX idx_contracts_external_id ON contracts (external_id);

-- ─────────────────────────────────────────────────────────
-- contract_status_histories
-- 상태 변경 이력. contracts는 현재 상태만 보유.
-- ─────────────────────────────────────────────────────────

CREATE TABLE contract_status_histories (
  id            UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id   UUID             NOT NULL REFERENCES contracts (id) ON DELETE CASCADE,
  from_status   contract_status,
  to_status     contract_status  NOT NULL,
  changed_at    TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  changed_by    TEXT             NOT NULL DEFAULT 'system',
  note          TEXT
);

CREATE INDEX idx_status_hist_contract ON contract_status_histories (contract_id);
CREATE INDEX idx_status_hist_changed_at ON contract_status_histories (changed_at);

-- ─────────────────────────────────────────────────────────
-- settlement_rules
-- 직급별 수당 설정. effective_from/until으로 기간 관리.
-- 사업본부장 수당은 이 테이블에서 관리 (하드코딩 금지).
-- ─────────────────────────────────────────────────────────

CREATE TABLE settlement_rules (
  id                       UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  rank                     rank_type NOT NULL,
  -- 기준 매출액 (1구좌당)
  base_amount_per_unit     INTEGER   NOT NULL DEFAULT 715000,
  -- 직급별 수당 (1구좌당)
  commission_per_unit      INTEGER   NOT NULL,
  -- 유지 장려금 기준 구좌 수 (NULL이면 장려금 없음)
  incentive_unit_threshold INTEGER,
  -- 유지 장려금 금액
  incentive_amount         INTEGER,
  effective_from           DATE      NOT NULL DEFAULT CURRENT_DATE,
  -- NULL이면 현재 적용 중
  effective_until          DATE,
  note                     TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 동일 직급의 현재 적용 규칙이 중복되지 않도록
  CONSTRAINT chk_effective_range CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE INDEX idx_settlement_rules_rank ON settlement_rules (rank);
CREATE INDEX idx_settlement_rules_effective ON settlement_rules (effective_from, effective_until);

-- 초기 정산 규칙 데이터
INSERT INTO settlement_rules (rank, commission_per_unit, incentive_unit_threshold, incentive_amount, note)
VALUES
  ('영업사원',  300000, NULL, NULL,      '영업사원 기본 수당'),
  ('리더',      400000, 20,   1000000,   '리더 기본 수당 + 산하 20구좌 이상 유지 장려금'),
  ('센터장',    500000, 100,  3000000,   '센터장 기본 수당 + 산하 100구좌 이상 유지 장려금'),
  ('사업본부장', 600000, 300,  5000000,   '사업본부장 기본 수당 (변경 가능) + 산하 300구좌 이상 유지 장려금');

-- ─────────────────────────────────────────────────────────
-- monthly_settlements
-- 월별 정산 스냅샷. 재계산 가능 구조.
-- calculation_detail JSONB에 계산 근거 전체 저장.
-- ─────────────────────────────────────────────────────────

CREATE TABLE monthly_settlements (
  id                      UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  year_month              TEXT      NOT NULL CHECK (year_month ~ '^\d{4}-\d{2}$'),
  member_id               UUID      NOT NULL REFERENCES organization_members (id),
  rank                    rank_type NOT NULL,
  -- 본인 직접 계약
  direct_contract_count   INTEGER   NOT NULL DEFAULT 0,
  direct_unit_count       INTEGER   NOT NULL DEFAULT 0,
  -- 산하 전체 구좌 (유지 장려금 기준)
  subordinate_unit_count  INTEGER   NOT NULL DEFAULT 0,
  total_unit_count        INTEGER   NOT NULL DEFAULT 0,
  -- 수당 항목
  base_commission         INTEGER   NOT NULL DEFAULT 0,
  rollup_commission       INTEGER   NOT NULL DEFAULT 0,
  incentive_amount        INTEGER   NOT NULL DEFAULT 0,
  total_amount            INTEGER   NOT NULL DEFAULT 0,
  -- 계산 근거 (감사/검증용)
  calculation_detail      JSONB,
  -- 확정 후 재계산 불가
  is_finalized            BOOLEAN   NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (year_month, member_id)
);

CREATE INDEX idx_monthly_sett_year_month ON monthly_settlements (year_month);
CREATE INDEX idx_monthly_sett_member ON monthly_settlements (member_id);
CREATE INDEX idx_monthly_sett_finalized ON monthly_settlements (is_finalized);

-- ─────────────────────────────────────────────────────────
-- sync_runs
-- 동기화 실행 기록
-- ─────────────────────────────────────────────────────────

CREATE TABLE sync_runs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at    TIMESTAMPTZ,
  status         sync_status NOT NULL DEFAULT 'running',
  total_fetched  INTEGER     NOT NULL DEFAULT 0,
  total_created  INTEGER     NOT NULL DEFAULT 0,
  total_updated  INTEGER     NOT NULL DEFAULT 0,
  total_errors   INTEGER     NOT NULL DEFAULT 0,
  triggered_by   TEXT        NOT NULL DEFAULT 'manual'
);

-- ─────────────────────────────────────────────────────────
-- sync_logs
-- 동기화 상세 로그
-- ─────────────────────────────────────────────────────────

CREATE TABLE sync_logs (
  id          UUID       PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID       REFERENCES sync_runs (id) ON DELETE CASCADE,
  level       log_level  NOT NULL,
  message     TEXT       NOT NULL,
  context     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sync_logs_run ON sync_logs (run_id);
CREATE INDEX idx_sync_logs_level ON sync_logs (level);
CREATE INDEX idx_sync_logs_created ON sync_logs (created_at);

-- ─────────────────────────────────────────────────────────
-- VIEW: v_contract_settlement_base
-- 정산 대상 계약 기본 뷰 (취소/해약/is_cancelled 제외)
-- ─────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_contract_settlement_base AS
SELECT
  c.id                  AS contract_id,
  c.contract_code,
  c.join_date,
  TO_CHAR(c.join_date, 'YYYY-MM') AS year_month,
  c.unit_count,
  c.status,
  c.is_cancelled,
  c.sales_member_id,
  om.name               AS sales_member_name,
  om.rank               AS sales_member_rank
FROM contracts c
LEFT JOIN organization_members om ON om.id = c.sales_member_id
WHERE
  c.status NOT IN ('취소', '해약')
  AND c.is_cancelled = FALSE;

-- ─────────────────────────────────────────────────────────
-- FUNCTION: get_subordinate_ids
-- 특정 멤버의 모든 하위 멤버 ID를 재귀적으로 반환
-- ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_subordinate_ids(p_member_id UUID)
RETURNS TABLE (subordinate_id UUID, depth INTEGER)
LANGUAGE SQL
STABLE
AS $$
  WITH RECURSIVE subordinates AS (
    SELECT
      oe.child_id AS subordinate_id,
      1           AS depth
    FROM organization_edges oe
    WHERE oe.parent_id = p_member_id

    UNION ALL

    SELECT
      oe.child_id,
      s.depth + 1
    FROM organization_edges oe
    INNER JOIN subordinates s ON s.subordinate_id = oe.parent_id
  )
  SELECT subordinate_id, depth FROM subordinates;
$$;

-- ─────────────────────────────────────────────────────────
-- FUNCTION: get_org_tree
-- 특정 멤버를 루트로 하는 전체 조직 트리 반환
-- ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_org_tree(p_root_id UUID)
RETURNS TABLE (
  id          UUID,
  name        TEXT,
  rank        rank_type,
  parent_id   UUID,
  depth       INTEGER
)
LANGUAGE SQL
STABLE
AS $$
  WITH RECURSIVE tree AS (
    SELECT
      m.id,
      m.name,
      m.rank,
      NULL::UUID AS parent_id,
      0          AS depth
    FROM organization_members m
    WHERE m.id = p_root_id

    UNION ALL

    SELECT
      m.id,
      m.name,
      m.rank,
      oe.parent_id,
      t.depth + 1
    FROM organization_members m
    INNER JOIN organization_edges oe ON oe.child_id = m.id
    INNER JOIN tree t ON t.id = oe.parent_id
  )
  SELECT id, name, rank, parent_id, depth FROM tree ORDER BY depth, name;
$$;

-- ─────────────────────────────────────────────────────────
-- updated_at 자동 갱신 트리거
-- ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_updated_at_customers
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_org_members
  BEFORE UPDATE ON organization_members
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_contracts
  BEFORE UPDATE ON contracts
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_monthly_settlements
  BEFORE UPDATE ON monthly_settlements
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ─────────────────────────────────────────────────────────
-- Row Level Security (기본 설정 - 추후 인증 연동 시 정책 추가)
-- ─────────────────────────────────────────────────────────

ALTER TABLE customers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_edges     ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_rules       ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_settlements    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_runs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_logs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_status_histories ENABLE ROW LEVEL SECURITY;

-- TODO: Supabase Auth 연동 후 역할별 RLS 정책 추가
-- 현재는 service_role만 접근 가능 (anon 접근 차단)
-- 예시:
-- CREATE POLICY "service_role_only" ON customers
--   USING (auth.role() = 'service_role');
