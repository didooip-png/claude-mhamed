-- AlterTable
ALTER TABLE "notification_subscriptions" ADD COLUMN     "schedule" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "job_runs" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "period_key" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "trigger" TEXT NOT NULL DEFAULT 'SCHEDULE',
    "detail" JSONB,
    "triggered_by" UUID,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_runs_name_started_at_idx" ON "job_runs"("name", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "job_runs_name_period_key_key" ON "job_runs"("name", "period_key");

-- Droits du rôle applicatif sur la nouvelle table.
SELECT pharmastock_apply_app_grants();
