ALTER TABLE "DailyProviderUsage"
  ADD COLUMN "costUsd" DECIMAL(18,6),
  ADD COLUMN "costSource" TEXT,
  ADD COLUMN "costMetadata" JSONB,
  ADD COLUMN "tokenDetails" JSONB,
  ADD COLUMN "sourceSnapshot" JSONB;

CREATE TABLE "DailyModelUsage" (
  "id" TEXT NOT NULL,
  "dailyProviderUsageId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "modelName" TEXT NOT NULL,
  "tokenCategories" JSONB NOT NULL,
  "tokenDetails" JSONB,
  "totalTokens" BIGINT NOT NULL,
  "costUsd" DECIMAL(18,6),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DailyModelUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyModelUsage_deviceId_provider_date_modelName_key"
  ON "DailyModelUsage"("deviceId", "provider", "date", "modelName");

CREATE INDEX "DailyModelUsage_memberId_date_idx"
  ON "DailyModelUsage"("memberId", "date");

CREATE INDEX "DailyModelUsage_provider_modelName_date_idx"
  ON "DailyModelUsage"("provider", "modelName", "date");

ALTER TABLE "DailyModelUsage"
  ADD CONSTRAINT "DailyModelUsage_dailyProviderUsageId_fkey"
  FOREIGN KEY ("dailyProviderUsageId") REFERENCES "DailyProviderUsage"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DailyModelUsage"
  ADD CONSTRAINT "DailyModelUsage_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "Member"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DailyModelUsage"
  ADD CONSTRAINT "DailyModelUsage_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "Device"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
