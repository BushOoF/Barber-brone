-- CreateEnum
CREATE TYPE "Lang" AS ENUM ('UZ', 'RU', 'EN');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "language" "Lang" NOT NULL DEFAULT 'UZ';
