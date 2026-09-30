-- AlterTable
ALTER TABLE "credit_notes" ADD COLUMN     "print_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "print_count" INTEGER NOT NULL DEFAULT 0;
