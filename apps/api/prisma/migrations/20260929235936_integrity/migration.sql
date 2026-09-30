-- Intégrité des données (docs/SPEC.md §3.1, §4, §7 « Contraintes base de données obligatoires »).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Contraintes CHECK : le stock n'est jamais négatif, les montants sont cohérents.
-- ---------------------------------------------------------------------------
ALTER TABLE lots ADD CONSTRAINT lots_remaining_qty_non_negative CHECK (remaining_qty >= 0);
ALTER TABLE lots ADD CONSTRAINT lots_initial_qty_non_negative CHECK (initial_qty >= 0);
ALTER TABLE lots ADD CONSTRAINT lots_unit_cost_non_negative CHECK (unit_cost_ht >= 0);

ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_qty_non_zero CHECK (qty <> 0);
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_balances_non_negative
  CHECK (lot_balance_after >= 0 AND product_balance_after >= 0);

ALTER TABLE products ADD CONSTRAINT products_prices_non_negative
  CHECK (sale_price_ttc >= 0 AND ref_purchase_price_ht >= 0 AND (unit_sale_price_ttc IS NULL OR unit_sale_price_ttc >= 0));
ALTER TABLE products ADD CONSTRAINT products_units_per_pack_positive CHECK (units_per_pack >= 1);
ALTER TABLE products ADD CONSTRAINT products_stock_thresholds CHECK (min_stock >= 0);

ALTER TABLE purchase_receipt_lines ADD CONSTRAINT receipt_lines_qty
  CHECK (qty >= 0 AND free_qty >= 0 AND qty + free_qty > 0 AND unit_price_ht >= 0 AND discount_bp BETWEEN 0 AND 10000);

ALTER TABLE sale_lines ADD CONSTRAINT sale_lines_qty
  CHECK (qty > 0 AND qty_base > 0 AND returned_qty_base >= 0 AND returned_qty_base <= qty_base
         AND discount_bp BETWEEN 0 AND 10000 AND unit_price_ttc >= 0 AND line_total_ttc >= 0);
ALTER TABLE sale_line_allocations ADD CONSTRAINT sale_line_allocations_qty
  CHECK (qty_base > 0 AND returned_qty_base >= 0 AND returned_qty_base <= qty_base);

ALTER TABLE sales ADD CONSTRAINT sales_amounts
  CHECK (total_ttc >= 0 AND amount_paid >= 0 AND amount_due >= 0 AND returned_amount >= 0);

ALTER TABLE payments ADD CONSTRAINT payments_amounts
  CHECK (amount > 0 AND refunded_amount >= 0 AND refunded_amount <= amount);
ALTER TABLE payment_allocations ADD CONSTRAINT payment_allocations_amount CHECK (amount > 0);
ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_amounts
  CHECK (amount > 0 AND remaining_amount >= 0 AND remaining_amount <= amount);
ALTER TABLE credit_note_allocations ADD CONSTRAINT credit_note_allocations_amount CHECK (amount > 0);
ALTER TABLE client_ledger ADD CONSTRAINT client_ledger_amounts
  CHECK (debit >= 0 AND credit >= 0 AND (debit > 0 OR credit > 0));
ALTER TABLE clients ADD CONSTRAINT clients_credit_limit CHECK (credit_limit >= 0 AND default_discount_bp BETWEEN 0 AND 10000);
ALTER TABLE customer_return_lines ADD CONSTRAINT customer_return_lines_qty CHECK (qty_base > 0 AND amount >= 0);
ALTER TABLE supplier_return_lines ADD CONSTRAINT supplier_return_lines_qty CHECK (qty > 0);
ALTER TABLE document_sequences ADD CONSTRAINT document_sequences_next CHECK (next_number >= 1);
ALTER TABLE cash_sessions ADD CONSTRAINT cash_sessions_float CHECK (opening_float >= 0);

-- Une seule session de caisse ouverte par poste.
CREATE UNIQUE INDEX cash_sessions_one_open_per_device ON cash_sessions (device_id) WHERE status = 'OPEN';
-- Un seul « client comptoir » et un seul taux de TVA par défaut.
CREATE UNIQUE INDEX clients_single_walk_in ON clients (is_walk_in) WHERE is_walk_in;
CREATE UNIQUE INDEX tva_rates_single_default ON tva_rates (is_default) WHERE is_default;

-- ---------------------------------------------------------------------------
-- Tables en ajout seul : toute modification ou suppression lève une exception.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pharmastock_forbid_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La table % est en ajout seul : % interdit', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stock_movements_append_only BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION pharmastock_forbid_modification();
CREATE TRIGGER stock_movements_no_truncate BEFORE TRUNCATE ON stock_movements
  FOR EACH STATEMENT EXECUTE FUNCTION pharmastock_forbid_modification();

CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION pharmastock_forbid_modification();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION pharmastock_forbid_modification();

CREATE TRIGGER client_ledger_append_only BEFORE UPDATE OR DELETE ON client_ledger
  FOR EACH ROW EXECUTE FUNCTION pharmastock_forbid_modification();
CREATE TRIGGER client_ledger_no_truncate BEFORE TRUNCATE ON client_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION pharmastock_forbid_modification();

-- ---------------------------------------------------------------------------
-- Recherche tolérante (accents supprimés côté application dans search_text).
-- ---------------------------------------------------------------------------
CREATE INDEX products_search_trgm ON products USING gin (search_text gin_trgm_ops);
CREATE INDEX clients_search_trgm ON clients USING gin (search_text gin_trgm_ops);
CREATE INDEX suppliers_search_trgm ON suppliers USING gin (search_text gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Défense en profondeur : droits du rôle applicatif (s'il existe).
-- En production, l'API se connecte avec « pharmastock_app » (non propriétaire) :
-- aucun droit UPDATE / DELETE / TRUNCATE sur les tables en ajout seul.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pharmastock_apply_app_grants(app_role text DEFAULT 'pharmastock_app') RETURNS void AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    RETURN;
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', app_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', app_role);
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', app_role);
  EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON stock_movements, audit_logs, client_ledger FROM %I', app_role);
  EXECUTE format('REVOKE ALL ON _prisma_migrations FROM %I', app_role);
  EXECUTE format('GRANT SELECT ON _prisma_migrations TO %I', app_role);
END;
$$ LANGUAGE plpgsql;

SELECT pharmastock_apply_app_grants();
