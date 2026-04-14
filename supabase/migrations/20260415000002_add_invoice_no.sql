-- =========================================================
-- TY Life Dashboard - Add invoice_no to contracts
-- 2026-04-15
-- =========================================================

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS invoice_no TEXT;

CREATE INDEX IF NOT EXISTS idx_contracts_invoice_no ON contracts (invoice_no);

