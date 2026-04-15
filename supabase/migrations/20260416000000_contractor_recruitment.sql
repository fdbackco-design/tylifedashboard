-- =========================================================
-- TY Life Dashboard - Contractor recruitment linkage
-- 2026-04-16
-- =========================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contractor_link_status') THEN
    CREATE TYPE contractor_link_status AS ENUM (
      'not_internal',
      'linked',
      'pending_mapping'
    );
  END IF;
END $$;

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS contractor_member_id UUID REFERENCES organization_members (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contractor_link_status contractor_link_status NOT NULL DEFAULT 'not_internal',
  ADD COLUMN IF NOT EXISTS contractor_candidates_json JSONB;

CREATE INDEX IF NOT EXISTS idx_contracts_contractor_member_id ON contracts (contractor_member_id);
CREATE INDEX IF NOT EXISTS idx_contracts_contractor_link_status ON contracts (contractor_link_status);

-- Edge 생성 근거(어떤 계약으로 편입됐는지) 저장용
CREATE TABLE IF NOT EXISTS organization_edge_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edge_id UUID NOT NULL REFERENCES organization_edges (id) ON DELETE CASCADE,
  source_contract_id UUID NOT NULL REFERENCES contracts (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT NOT NULL DEFAULT 'system',
  note TEXT,
  UNIQUE(edge_id, source_contract_id)
);

CREATE INDEX IF NOT EXISTS idx_edge_sources_edge_id ON organization_edge_sources (edge_id);
CREATE INDEX IF NOT EXISTS idx_edge_sources_source_contract_id ON organization_edge_sources (source_contract_id);

