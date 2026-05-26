-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "locationLat" DOUBLE PRECISION,
ADD COLUMN     "locationLng" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "VacationDay" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VacationDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VacationDay_date_key" ON "VacationDay"("date");

-- CreateIndex
CREATE INDEX "VacationDay_date_idx" ON "VacationDay"("date");
