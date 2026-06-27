-- CreateEnum
CREATE TYPE "FinanceKind" AS ENUM ('INCOME', 'EXPENSE');

-- AlterTable: allow placeholder (phone-only) users without a Telegram account yet
ALTER TABLE "User" ALTER COLUMN "telegramId" DROP NOT NULL;

-- AlterTable: voice AI feature removed
ALTER TABLE "Settings" DROP COLUMN "hasVoiceFeature";

-- CreateTable
CREATE TABLE "FinanceEntry" (
    "id" TEXT NOT NULL,
    "kind" "FinanceKind" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "note" TEXT,
    "date" TEXT NOT NULL,
    "repeatEveryDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinanceEntry_date_idx" ON "FinanceEntry"("date");
