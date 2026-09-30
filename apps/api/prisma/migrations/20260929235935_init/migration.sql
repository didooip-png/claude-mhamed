-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "DeviceKind" AS ENUM ('WEB', 'DESKTOP');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('PENDING', 'APPROVED', 'REVOKED');

-- CreateEnum
CREATE TYPE "CategoryKind" AS ENUM ('MEDICINE', 'PARAPHARMACY', 'MEDICAL_DEVICE', 'OTHER');

-- CreateEnum
CREATE TYPE "ControlledClass" AS ENUM ('NONE', 'A', 'B', 'C');

-- CreateEnum
CREATE TYPE "SupplySource" AS ENUM ('SUPPLIER', 'DONATION', 'TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('DRAFT', 'VALIDATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LotStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'QUARANTINE', 'EXHAUSTED');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('PURCHASE_IN', 'SALE_OUT', 'SALE_CANCEL', 'CUSTOMER_RETURN_IN', 'SUPPLIER_RETURN_OUT', 'INVENTORY_ADJUSTMENT', 'LOSS', 'BREAKAGE', 'EXPIRED_DESTRUCTION', 'CORRECTION', 'RECEIPT_CANCEL');

-- CreateEnum
CREATE TYPE "CounterpartType" AS ENUM ('CLIENT', 'SUPPLIER', 'NONE');

-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('INDIVIDUAL', 'PHARMACY', 'CLINIC', 'HOSPITAL', 'ASSOCIATION', 'COMPANY', 'OTHER');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('DRAFT', 'ON_HOLD', 'VALIDATED', 'CANCELLED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "SalePaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID');

-- CreateEnum
CREATE TYPE "SaleReturnStatus" AS ENUM ('NONE', 'PARTIALLY_RETURNED', 'RETURNED');

-- CreateEnum
CREATE TYPE "SaleUnit" AS ENUM ('PACK', 'UNIT');

-- CreateEnum
CREATE TYPE "DraftEventType" AS ENUM ('ADD', 'REMOVE', 'QTY_CHANGE', 'PRICE_CHANGE', 'DISCOUNT_CHANGE', 'LOT_FORCE', 'CLIENT_CHANGE', 'HOLD', 'RESUME', 'DISCARD');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'CHEQUE', 'TRANSFER', 'DRAFT_BILL');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('VALID', 'CANCELLED', 'BOUNCED');

-- CreateEnum
CREATE TYPE "ChequeStatus" AS ENUM ('IN_PORTFOLIO', 'DEPOSITED', 'CASHED', 'BOUNCED');

-- CreateEnum
CREATE TYPE "RefundMode" AS ENUM ('CREDIT', 'CASH');

-- CreateEnum
CREATE TYPE "ReturnLineDestination" AS ENUM ('RESTOCK', 'QUARANTINE', 'DESTRUCTION');

-- CreateEnum
CREATE TYPE "CreditNoteSource" AS ENUM ('RETURN', 'OTHER');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('INVOICE', 'PAYMENT', 'CREDIT_NOTE', 'INVOICE_CANCEL', 'PAYMENT_CANCEL', 'REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CashSessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('OPENING_FLOAT', 'SALE_PAYMENT', 'REFUND', 'EXPENSE', 'DEPOSIT', 'WITHDRAWAL', 'DRAWER_OPEN');

-- CreateEnum
CREATE TYPE "InventoryStatus" AS ENUM ('COUNTING', 'VALIDATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AdjustmentType" AS ENUM ('LOSS', 'BREAKAGE', 'EXPIRED_DESTRUCTION', 'CORRECTION');

-- CreateEnum
CREATE TYPE "AdjustmentStatus" AS ENUM ('PENDING', 'VALIDATED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SupplierReturnStatus" AS ENUM ('PENDING_CREDIT', 'CREDIT_RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "NotificationMode" AS ENUM ('OFF', 'IN_APP', 'EMAIL_IMMEDIATE', 'EMAIL_DAILY', 'EMAIL_WEEKLY');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DigestType" AS ENUM ('DAILY', 'WEEKLY', 'ACTIVITY');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "sites" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT,
    "password_hash" TEXT NOT NULL,
    "pin_hash" TEXT,
    "role_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "pin_failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "totp_secret" TEXT,
    "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMPTZ(3),
    "notification_email" TEXT,
    "digest_daily_time" TEXT NOT NULL DEFAULT '20:00',
    "digest_weekly_day" INTEGER NOT NULL DEFAULT 6,
    "digest_weekly_time" TEXT NOT NULL DEFAULT '20:00',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "system_key" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "key" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_key" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_key")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" UUID,
    "refresh_token_hash" TEXT NOT NULL,
    "previous_token_hash" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(3),
    "absolute_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "DeviceKind" NOT NULL DEFAULT 'WEB',
    "token_hash" TEXT NOT NULL,
    "status" "DeviceStatus" NOT NULL DEFAULT 'PENDING',
    "site_id" UUID NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3),
    "last_ip" TEXT,
    "user_agent" TEXT,
    "printer" JSONB,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "revoked_by" UUID,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "document_sequences" (
    "doc_type" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "prefix" TEXT NOT NULL,
    "next_number" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("doc_type","year")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CategoryKind" NOT NULL DEFAULT 'MEDICINE',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "laboratories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "laboratories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "therapeutic_classes" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "therapeutic_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tva_rates" (
    "id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "rate_bp" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tva_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "internal_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dci" TEXT,
    "dosage" TEXT,
    "form" TEXT,
    "presentation" TEXT,
    "laboratory_id" UUID,
    "category_id" UUID NOT NULL,
    "therapeutic_class_id" UUID,
    "tva_rate_id" UUID NOT NULL,
    "ref_purchase_price_ht" BIGINT NOT NULL DEFAULT 0,
    "sale_price_ttc" BIGINT NOT NULL,
    "units_per_pack" INTEGER NOT NULL DEFAULT 1,
    "sell_by_unit" BOOLEAN NOT NULL DEFAULT false,
    "unit_sale_price_ttc" BIGINT,
    "requires_prescription" BOOLEAN NOT NULL DEFAULT false,
    "controlled_class" "ControlledClass" NOT NULL DEFAULT 'NONE',
    "cold_chain" BOOLEAN NOT NULL DEFAULT false,
    "returnable" BOOLEAN NOT NULL DEFAULT true,
    "location" TEXT,
    "min_stock" INTEGER NOT NULL DEFAULT 0,
    "max_stock" INTEGER,
    "reorder_point" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "search_text" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_barcodes" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "barcode" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_barcodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_price_history" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "old_value" BIGINT,
    "new_value" BIGINT,
    "changed_by" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tax_id" TEXT,
    "contact_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "payment_terms_days" INTEGER NOT NULL DEFAULT 0,
    "lead_time_days" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "search_text" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "type" "ClientType" NOT NULL DEFAULT 'INDIVIDUAL',
    "name" TEXT NOT NULL,
    "national_id_or_tax_id" TEXT,
    "phone" TEXT,
    "phone2" TEXT,
    "email" TEXT,
    "address" TEXT,
    "credit_limit" BIGINT NOT NULL DEFAULT 0,
    "default_discount_bp" INTEGER NOT NULL DEFAULT 0,
    "payment_terms_days" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_walk_in" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "email_consent" BOOLEAN NOT NULL DEFAULT false,
    "email_consent_at" TIMESTAMPTZ(3),
    "email_consent_by" UUID,
    "email_doc_prefs" JSONB NOT NULL DEFAULT '{"INVOICE":true,"INVOICE_CANCELLED":true,"CREDIT_NOTE":true,"PAYMENT_RECEIPT":true,"STATEMENT":true,"DUNNING":true}',
    "email_cc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "email_bounced" BOOLEAN NOT NULL DEFAULT false,
    "search_text" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_receipts" (
    "id" UUID NOT NULL,
    "number" TEXT,
    "site_id" UUID NOT NULL,
    "source_type" "SupplySource" NOT NULL,
    "source_reason" TEXT,
    "supplier_id" UUID,
    "supplier_invoice_ref" TEXT,
    "supplier_invoice_date" DATE,
    "received_at" DATE NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'DRAFT',
    "total_ht" BIGINT NOT NULL DEFAULT 0,
    "total_tva" BIGINT NOT NULL DEFAULT 0,
    "total_ttc" BIGINT NOT NULL DEFAULT 0,
    "attachment_id" UUID,
    "notes" TEXT,
    "device_id" UUID,
    "created_by" UUID NOT NULL,
    "validated_by" UUID,
    "validated_at" TIMESTAMPTZ(3),
    "cancelled_by" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "purchase_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_receipt_lines" (
    "id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "product_id" UUID NOT NULL,
    "lot_number" TEXT NOT NULL,
    "expiry_date" DATE NOT NULL,
    "qty" INTEGER NOT NULL,
    "free_qty" INTEGER NOT NULL DEFAULT 0,
    "unit_price_ht" BIGINT NOT NULL,
    "discount_bp" INTEGER NOT NULL DEFAULT 0,
    "tva_rate_bp" INTEGER NOT NULL,
    "line_total_ht" BIGINT NOT NULL,
    "lot_id" UUID,

    CONSTRAINT "purchase_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lots" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "lot_number" TEXT NOT NULL,
    "expiry_date" DATE NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "initial_qty" INTEGER NOT NULL,
    "remaining_qty" INTEGER NOT NULL,
    "unit_cost_ht" BIGINT NOT NULL,
    "supplier_id" UUID,
    "source_type" "SupplySource" NOT NULL,
    "status" "LotStatus" NOT NULL DEFAULT 'ACTIVE',
    "block_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_returns" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "site_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "status" "SupplierReturnStatus" NOT NULL DEFAULT 'PENDING_CREDIT',
    "reason" TEXT NOT NULL,
    "total_ht" BIGINT NOT NULL,
    "credit_amount" BIGINT,
    "credit_received_at" TIMESTAMPTZ(3),
    "credit_reference" TEXT,
    "notes" TEXT,
    "device_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_return_lines" (
    "id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_cost_ht" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "supplier_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" BIGSERIAL NOT NULL,
    "site_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_cost_ht" BIGINT NOT NULL,
    "unit_price_ttc" BIGINT,
    "product_balance_after" INTEGER NOT NULL,
    "lot_balance_after" INTEGER NOT NULL,
    "document_type" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "document_number" TEXT,
    "counterpart_type" "CounterpartType" NOT NULL DEFAULT 'NONE',
    "counterpart_id" UUID,
    "counterpart_name" TEXT,
    "reason" TEXT,
    "user_id" UUID NOT NULL,
    "authorized_by" UUID,
    "device_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL,
    "number" TEXT,
    "site_id" UUID NOT NULL,
    "client_id" UUID,
    "status" "SaleStatus" NOT NULL DEFAULT 'DRAFT',
    "payment_status" "SalePaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "return_status" "SaleReturnStatus" NOT NULL DEFAULT 'NONE',
    "subtotal_ht" BIGINT NOT NULL DEFAULT 0,
    "total_tva" BIGINT NOT NULL DEFAULT 0,
    "total_discount" BIGINT NOT NULL DEFAULT 0,
    "stamp_duty" BIGINT NOT NULL DEFAULT 0,
    "total_ttc" BIGINT NOT NULL DEFAULT 0,
    "total_cost" BIGINT NOT NULL DEFAULT 0,
    "amount_paid" BIGINT NOT NULL DEFAULT 0,
    "amount_due" BIGINT NOT NULL DEFAULT 0,
    "returned_amount" BIGINT NOT NULL DEFAULT 0,
    "tax_breakdown" JSONB,
    "global_discount_bp" INTEGER NOT NULL DEFAULT 0,
    "prescriber_name" TEXT,
    "prescription_ref" TEXT,
    "prescription_date" DATE,
    "due_date" DATE,
    "replaces_sale_id" UUID,
    "cash_session_id" UUID,
    "device_id" UUID,
    "idempotency_key" TEXT,
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "validated_by" UUID,
    "validated_at" TIMESTAMPTZ(3),
    "authorized_by" UUID,
    "held_at" TIMESTAMPTZ(3),
    "held_by" UUID,
    "cancelled_by" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "cancel_authorized_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_lines" (
    "id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "product_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit" "SaleUnit" NOT NULL DEFAULT 'PACK',
    "qty_base" INTEGER NOT NULL,
    "catalog_price_ttc" BIGINT NOT NULL,
    "unit_price_ttc" BIGINT NOT NULL,
    "discount_bp" INTEGER NOT NULL DEFAULT 0,
    "discount_amount" BIGINT NOT NULL DEFAULT 0,
    "tva_rate_bp" INTEGER NOT NULL,
    "line_total_ttc" BIGINT NOT NULL,
    "cost_total" BIGINT NOT NULL DEFAULT 0,
    "returned_qty_base" INTEGER NOT NULL DEFAULT 0,
    "forced_lot_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_line_allocations" (
    "id" UUID NOT NULL,
    "sale_line_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "qty_base" INTEGER NOT NULL,
    "unit_cost_ht" BIGINT NOT NULL,
    "returned_qty_base" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sale_line_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_draft_events" (
    "id" BIGSERIAL NOT NULL,
    "sale_id" UUID NOT NULL,
    "event" "DraftEventType" NOT NULL,
    "product_id" UUID,
    "qty" INTEGER,
    "details" JSONB,
    "user_id" UUID NOT NULL,
    "device_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_draft_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_returns" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "site_id" UUID NOT NULL,
    "sale_id" UUID,
    "client_id" UUID NOT NULL,
    "total_ttc" BIGINT NOT NULL,
    "refund_mode" "RefundMode" NOT NULL,
    "reason" TEXT NOT NULL,
    "cash_session_id" UUID,
    "device_id" UUID,
    "idempotency_key" TEXT,
    "created_by" UUID NOT NULL,
    "authorized_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_return_lines" (
    "id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "sale_line_id" UUID,
    "product_id" UUID NOT NULL,
    "qty_base" INTEGER NOT NULL,
    "amount" BIGINT NOT NULL,
    "resellable" BOOLEAN NOT NULL,
    "destination" "ReturnLineDestination" NOT NULL,
    "lot_id" UUID NOT NULL,
    "unit_cost_ht" BIGINT NOT NULL,

    CONSTRAINT "customer_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_notes" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "client_id" UUID NOT NULL,
    "return_id" UUID,
    "source" "CreditNoteSource" NOT NULL DEFAULT 'RETURN',
    "amount" BIGINT NOT NULL,
    "remaining_amount" BIGINT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_note_allocations" (
    "id" UUID NOT NULL,
    "credit_note_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by" UUID,

    CONSTRAINT "credit_note_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "client_id" UUID NOT NULL,
    "paid_at" TIMESTAMPTZ(3) NOT NULL,
    "amount" BIGINT NOT NULL,
    "refunded_amount" BIGINT NOT NULL DEFAULT 0,
    "method" "PaymentMethod" NOT NULL,
    "cheque_number" TEXT,
    "bank" TEXT,
    "due_date" DATE,
    "reference" TEXT,
    "cheque_status" "ChequeStatus",
    "status" "PaymentStatus" NOT NULL DEFAULT 'VALID',
    "cash_session_id" UUID,
    "sale_id" UUID,
    "device_id" UUID,
    "idempotency_key" TEXT,
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "cancelled_by" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by" UUID,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_ledger" (
    "id" BIGSERIAL NOT NULL,
    "client_id" UUID NOT NULL,
    "entry_type" "LedgerEntryType" NOT NULL,
    "debit" BIGINT NOT NULL DEFAULT 0,
    "credit" BIGINT NOT NULL DEFAULT 0,
    "balance_after" BIGINT NOT NULL,
    "document_type" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "document_number" TEXT,
    "description" TEXT,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_sessions" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "site_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opening_float" BIGINT NOT NULL,
    "closed_at" TIMESTAMPTZ(3),
    "expected_amount" BIGINT,
    "counted_amount" BIGINT,
    "difference" BIGINT,
    "denominations" JSONB,
    "status" "CashSessionStatus" NOT NULL DEFAULT 'OPEN',
    "closed_by" UUID,
    "notes" TEXT,

    CONSTRAINT "cash_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" BIGSERIAL NOT NULL,
    "session_id" UUID NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "amount" BIGINT NOT NULL,
    "reason" TEXT,
    "document_type" TEXT,
    "document_id" TEXT,
    "document_ref" TEXT,
    "user_id" UUID NOT NULL,
    "authorized_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventories" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "site_id" UUID NOT NULL,
    "scope" JSONB NOT NULL,
    "scope_label" TEXT NOT NULL,
    "status" "InventoryStatus" NOT NULL DEFAULT 'COUNTING',
    "notes" TEXT,
    "started_by" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validated_by" UUID,
    "validated_at" TIMESTAMPTZ(3),
    "cancelled_by" UUID,
    "cancelled_at" TIMESTAMPTZ(3),

    CONSTRAINT "inventories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_lines" (
    "id" UUID NOT NULL,
    "inventory_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "snapshot_qty" INTEGER NOT NULL,
    "theoretical_at_count" INTEGER,
    "counted_qty" INTEGER,
    "difference" INTEGER,
    "unit_cost_ht" BIGINT NOT NULL,
    "counted_by" UUID,
    "counted_at" TIMESTAMPTZ(3),
    "count_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "inventory_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustments" (
    "id" UUID NOT NULL,
    "number" TEXT,
    "site_id" UUID NOT NULL,
    "type" "AdjustmentType" NOT NULL,
    "status" "AdjustmentStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "device_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validated_by" UUID,
    "validated_at" TIMESTAMPTZ(3),
    "rejected_reason" TEXT,

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustment_lines" (
    "id" UUID NOT NULL,
    "adjustment_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_cost_ht" BIGINT NOT NULL,

    CONSTRAINT "stock_adjustment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" UUID,
    "user_code" TEXT,
    "user_name" TEXT,
    "authorized_by" UUID,
    "authorized_by_code" TEXT,
    "device_id" UUID,
    "device_name" TEXT,
    "ip" TEXT,
    "event_type" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "entity_ref" TEXT,
    "summary" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "reason" TEXT,
    "prev_hash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "link" TEXT,
    "dedupe_key" TEXT,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "mode" "NotificationMode" NOT NULL,
    "watched_user_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "thresholds" JSONB NOT NULL DEFAULT '{}',
    "outside_hours_only" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_events" (
    "id" BIGSERIAL NOT NULL,
    "event_type" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "actor_id" UUID,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "link" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "outside_hours" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_templates" (
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body_mjml" TEXT NOT NULL,
    "body_text" TEXT NOT NULL,
    "is_customized" BOOLEAN NOT NULL DEFAULT false,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "email_outbox" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "to" TEXT[],
    "cc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bcc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subject" TEXT,
    "template_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "attachment_refs" JSONB NOT NULL DEFAULT '[]',
    "related_entity_type" TEXT,
    "related_entity_id" TEXT,
    "client_id" UUID,
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "provider_message_id" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "digest_runs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "digest_type" "DigestType" NOT NULL,
    "period_start" TIMESTAMPTZ(3) NOT NULL,
    "period_end" TIMESTAMPTZ(3) NOT NULL,
    "outbox_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "digest_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backups" (
    "id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "status" "BackupStatus" NOT NULL DEFAULT 'RUNNING',
    "filename" TEXT,
    "size_bytes" BIGINT,
    "offsite_status" TEXT,
    "error" TEXT,
    "triggered_by" UUID,

    CONSTRAINT "backups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_code_key" ON "users"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "roles_system_key_key" ON "roles"("system_key");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refresh_token_hash_key" ON "sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "devices_token_hash_key" ON "devices"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "laboratories_name_key" ON "laboratories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "therapeutic_classes_name_key" ON "therapeutic_classes"("name");

-- CreateIndex
CREATE UNIQUE INDEX "tva_rates_label_key" ON "tva_rates"("label");

-- CreateIndex
CREATE UNIQUE INDEX "products_internal_code_key" ON "products"("internal_code");

-- CreateIndex
CREATE INDEX "products_dci_idx" ON "products"("dci");

-- CreateIndex
CREATE INDEX "products_category_id_idx" ON "products"("category_id");

-- CreateIndex
CREATE INDEX "products_laboratory_id_idx" ON "products"("laboratory_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_barcodes_barcode_key" ON "product_barcodes"("barcode");

-- CreateIndex
CREATE INDEX "product_barcodes_product_id_idx" ON "product_barcodes"("product_id");

-- CreateIndex
CREATE INDEX "product_price_history_product_id_changed_at_idx" ON "product_price_history"("product_id", "changed_at");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_code_key" ON "suppliers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "clients_code_key" ON "clients"("code");

-- CreateIndex
CREATE INDEX "clients_phone_idx" ON "clients"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_receipts_number_key" ON "purchase_receipts"("number");

-- CreateIndex
CREATE INDEX "purchase_receipts_status_received_at_idx" ON "purchase_receipts"("status", "received_at");

-- CreateIndex
CREATE INDEX "purchase_receipts_supplier_id_idx" ON "purchase_receipts"("supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_receipt_lines_lot_id_key" ON "purchase_receipt_lines"("lot_id");

-- CreateIndex
CREATE INDEX "purchase_receipt_lines_receipt_id_idx" ON "purchase_receipt_lines"("receipt_id");

-- CreateIndex
CREATE INDEX "lots_product_id_status_expiry_date_received_at_idx" ON "lots"("product_id", "status", "expiry_date", "received_at");

-- CreateIndex
CREATE INDEX "lots_lot_number_idx" ON "lots"("lot_number");

-- CreateIndex
CREATE INDEX "lots_expiry_date_idx" ON "lots"("expiry_date");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_returns_number_key" ON "supplier_returns"("number");

-- CreateIndex
CREATE INDEX "supplier_return_lines_return_id_idx" ON "supplier_return_lines"("return_id");

-- CreateIndex
CREATE INDEX "stock_movements_product_id_created_at_idx" ON "stock_movements"("product_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_lot_id_created_at_idx" ON "stock_movements"("lot_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_document_type_document_id_idx" ON "stock_movements"("document_type", "document_id");

-- CreateIndex
CREATE INDEX "stock_movements_created_at_idx" ON "stock_movements"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sales_number_key" ON "sales"("number");

-- CreateIndex
CREATE UNIQUE INDEX "sales_replaces_sale_id_key" ON "sales"("replaces_sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_idempotency_key_key" ON "sales"("idempotency_key");

-- CreateIndex
CREATE INDEX "sales_status_validated_at_idx" ON "sales"("status", "validated_at");

-- CreateIndex
CREATE INDEX "sales_client_id_validated_at_idx" ON "sales"("client_id", "validated_at");

-- CreateIndex
CREATE INDEX "sales_created_by_idx" ON "sales"("created_by");

-- CreateIndex
CREATE INDEX "sales_validated_at_idx" ON "sales"("validated_at");

-- CreateIndex
CREATE INDEX "sale_lines_sale_id_idx" ON "sale_lines"("sale_id");

-- CreateIndex
CREATE INDEX "sale_lines_product_id_idx" ON "sale_lines"("product_id");

-- CreateIndex
CREATE INDEX "sale_line_allocations_sale_line_id_idx" ON "sale_line_allocations"("sale_line_id");

-- CreateIndex
CREATE INDEX "sale_line_allocations_lot_id_idx" ON "sale_line_allocations"("lot_id");

-- CreateIndex
CREATE INDEX "sale_draft_events_sale_id_idx" ON "sale_draft_events"("sale_id");

-- CreateIndex
CREATE INDEX "sale_draft_events_user_id_created_at_idx" ON "sale_draft_events"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "customer_returns_number_key" ON "customer_returns"("number");

-- CreateIndex
CREATE UNIQUE INDEX "customer_returns_idempotency_key_key" ON "customer_returns"("idempotency_key");

-- CreateIndex
CREATE INDEX "customer_returns_client_id_idx" ON "customer_returns"("client_id");

-- CreateIndex
CREATE INDEX "customer_returns_created_at_idx" ON "customer_returns"("created_at");

-- CreateIndex
CREATE INDEX "customer_return_lines_return_id_idx" ON "customer_return_lines"("return_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_number_key" ON "credit_notes"("number");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_return_id_key" ON "credit_notes"("return_id");

-- CreateIndex
CREATE INDEX "credit_notes_client_id_idx" ON "credit_notes"("client_id");

-- CreateIndex
CREATE INDEX "credit_note_allocations_sale_id_idx" ON "credit_note_allocations"("sale_id");

-- CreateIndex
CREATE INDEX "credit_note_allocations_credit_note_id_idx" ON "credit_note_allocations"("credit_note_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_number_key" ON "payments"("number");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "payments_client_id_paid_at_idx" ON "payments"("client_id", "paid_at");

-- CreateIndex
CREATE INDEX "payments_method_cheque_status_idx" ON "payments"("method", "cheque_status");

-- CreateIndex
CREATE INDEX "payments_paid_at_idx" ON "payments"("paid_at");

-- CreateIndex
CREATE INDEX "payment_allocations_sale_id_idx" ON "payment_allocations"("sale_id");

-- CreateIndex
CREATE INDEX "payment_allocations_payment_id_idx" ON "payment_allocations"("payment_id");

-- CreateIndex
CREATE INDEX "client_ledger_client_id_created_at_idx" ON "client_ledger"("client_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "cash_sessions_number_key" ON "cash_sessions"("number");

-- CreateIndex
CREATE INDEX "cash_sessions_device_id_status_idx" ON "cash_sessions"("device_id", "status");

-- CreateIndex
CREATE INDEX "cash_sessions_opened_at_idx" ON "cash_sessions"("opened_at");

-- CreateIndex
CREATE INDEX "cash_movements_session_id_idx" ON "cash_movements"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventories_number_key" ON "inventories"("number");

-- CreateIndex
CREATE INDEX "inventory_lines_inventory_id_product_id_idx" ON "inventory_lines"("inventory_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_lines_inventory_id_lot_id_key" ON "inventory_lines"("inventory_id", "lot_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustments_number_key" ON "stock_adjustments"("number");

-- CreateIndex
CREATE INDEX "stock_adjustments_status_idx" ON "stock_adjustments"("status");

-- CreateIndex
CREATE INDEX "stock_adjustment_lines_adjustment_id_idx" ON "stock_adjustment_lines"("adjustment_id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_hash_key" ON "audit_logs"("hash");

-- CreateIndex
CREATE INDEX "audit_logs_occurred_at_idx" ON "audit_logs"("occurred_at");

-- CreateIndex
CREATE INDEX "audit_logs_event_type_occurred_at_idx" ON "audit_logs"("event_type", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_occurred_at_idx" ON "audit_logs"("user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_key" ON "notifications"("user_id", "dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "notification_subscriptions_user_id_event_type_key" ON "notification_subscriptions"("user_id", "event_type");

-- CreateIndex
CREATE INDEX "notification_events_processed_at_idx" ON "notification_events"("processed_at");

-- CreateIndex
CREATE INDEX "notification_events_event_type_created_at_idx" ON "notification_events"("event_type", "created_at");

-- CreateIndex
CREATE INDEX "email_outbox_status_next_attempt_at_idx" ON "email_outbox"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "email_outbox_related_entity_type_related_entity_id_idx" ON "email_outbox"("related_entity_type", "related_entity_id");

-- CreateIndex
CREATE INDEX "email_outbox_client_id_idx" ON "email_outbox"("client_id");

-- CreateIndex
CREATE INDEX "email_outbox_created_at_idx" ON "email_outbox"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "digest_runs_user_id_digest_type_period_start_key" ON "digest_runs"("user_id", "digest_type", "period_start");

-- CreateIndex
CREATE INDEX "backups_started_at_idx" ON "backups"("started_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_fkey" FOREIGN KEY ("permission_key") REFERENCES "permissions"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_laboratory_id_fkey" FOREIGN KEY ("laboratory_id") REFERENCES "laboratories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_therapeutic_class_id_fkey" FOREIGN KEY ("therapeutic_class_id") REFERENCES "therapeutic_classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tva_rate_id_fkey" FOREIGN KEY ("tva_rate_id") REFERENCES "tva_rates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_price_history" ADD CONSTRAINT "product_price_history_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "purchase_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "supplier_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_replaces_sale_id_fkey" FOREIGN KEY ("replaces_sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_line_allocations" ADD CONSTRAINT "sale_line_allocations_sale_line_id_fkey" FOREIGN KEY ("sale_line_id") REFERENCES "sale_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_line_allocations" ADD CONSTRAINT "sale_line_allocations_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_draft_events" ADD CONSTRAINT "sale_draft_events_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_return_lines" ADD CONSTRAINT "customer_return_lines_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "customer_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_return_lines" ADD CONSTRAINT "customer_return_lines_sale_line_id_fkey" FOREIGN KEY ("sale_line_id") REFERENCES "sale_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "customer_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_allocations" ADD CONSTRAINT "credit_note_allocations_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "credit_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_allocations" ADD CONSTRAINT "credit_note_allocations_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_ledger" ADD CONSTRAINT "client_ledger_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "cash_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventories" ADD CONSTRAINT "inventories_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_lines" ADD CONSTRAINT "inventory_lines_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "inventories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_adjustment_id_fkey" FOREIGN KEY ("adjustment_id") REFERENCES "stock_adjustments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_subscriptions" ADD CONSTRAINT "notification_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

