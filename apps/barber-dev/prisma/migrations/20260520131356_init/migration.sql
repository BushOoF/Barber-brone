-- CreateEnum
CREATE TYPE "FeeStatus" AS ENUM ('PENDING', 'COLLECTED', 'WAIVED');

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerTelegramId" BIGINT NOT NULL,
    "ownerUsername" TEXT,
    "ownerName" TEXT,
    "botUsername" TEXT,
    "dbUrl" TEXT,
    "monthlyFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "hasApprenticeFeature" BOOLEAN NOT NULL DEFAULT true,
    "location" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Operator" (
    "id" TEXT NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "isSuper" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Operator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeCollection" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "status" "FeeStatus" NOT NULL DEFAULT 'PENDING',
    "collectedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevenueSnapshot" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "revenueMinor" INTEGER NOT NULL,
    "bookingsCount" INTEGER NOT NULL,
    "cachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevenueSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderTick" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderTick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_slug_key" ON "Shop"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Operator_telegramId_key" ON "Operator"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "FeeCollection_shopId_monthKey_key" ON "FeeCollection"("shopId", "monthKey");

-- CreateIndex
CREATE UNIQUE INDEX "RevenueSnapshot_shopId_monthKey_key" ON "RevenueSnapshot"("shopId", "monthKey");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderTick_kind_key" ON "ReminderTick"("kind");

-- AddForeignKey
ALTER TABLE "FeeCollection" ADD CONSTRAINT "FeeCollection_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueSnapshot" ADD CONSTRAINT "RevenueSnapshot_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
