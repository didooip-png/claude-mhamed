-- AlterTable
ALTER TABLE "cash_sessions" ADD COLUMN     "close_notes" TEXT;

-- AlterTable
ALTER TABLE "sale_lines" ADD COLUMN     "below_cost_authorized_by" UUID,
ADD COLUMN     "discount_authorized_by" UUID,
ADD COLUMN     "lot_authorized_by" UUID,
ADD COLUMN     "price_authorized_by" UUID;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "cash_tendered" BIGINT,
ADD COLUMN     "change_given" BIGINT,
ADD COLUMN     "credit_authorized_by" UUID,
ADD COLUMN     "print_count" INTEGER NOT NULL DEFAULT 0;
