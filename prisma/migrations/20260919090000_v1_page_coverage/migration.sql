-- Cover a whole page.
--
-- PageCoverage is a plan of the test cases one page needs, trimmed and approved
-- by a person before anything is spent; PageCoverageItem is each planned test
-- case and how proving it went.
--
-- Additive only: two new tables and two enums.

-- CreateEnum
CREATE TYPE "PageCoverageStatus" AS ENUM ('PLANNED', 'PROVING', 'PAUSED', 'DONE');

-- CreateEnum
CREATE TYPE "PageCoverageItemStatus" AS ENUM ('PROPOSED', 'SKIPPED', 'QUEUED', 'PROVING', 'PASSED', 'PARTIAL', 'FAILED', 'ERROR');

-- CreateTable
CREATE TABLE "PageCoverage" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "pageUrl" TEXT NOT NULL,
    "pageTitle" VARCHAR(300) NOT NULL,
    "focus" TEXT NOT NULL,
    "status" "PageCoverageStatus" NOT NULL DEFAULT 'PLANNED',
    "message" TEXT,
    "controls" JSONB NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PageCoverage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageCoverageItem" (
    "id" UUID NOT NULL,
    "pageCoverageId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "objective" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "expectedResults" JSONB NOT NULL,
    "priority" "TestCasePriority" NOT NULL DEFAULT 'MEDIUM',
    "rationale" TEXT NOT NULL,
    "status" "PageCoverageItemStatus" NOT NULL DEFAULT 'PROPOSED',
    "testCaseId" UUID,
    "code" TEXT,
    "checks" INTEGER,
    "fixes" INTEGER,
    "detail" TEXT,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "PageCoverageItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PageCoverage_organizationId_projectId_createdAt_idx" ON "PageCoverage"("organizationId", "projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PageCoverage_organizationId_projectId_id_key" ON "PageCoverage"("organizationId", "projectId", "id");

-- CreateIndex
CREATE INDEX "PageCoverageItem_pageCoverageId_status_idx" ON "PageCoverageItem"("pageCoverageId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PageCoverageItem_pageCoverageId_position_key" ON "PageCoverageItem"("pageCoverageId", "position");

-- AddForeignKey
ALTER TABLE "PageCoverage" ADD CONSTRAINT "PageCoverage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PageCoverage" ADD CONSTRAINT "PageCoverage_organizationId_projectId_fkey" FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PageCoverage" ADD CONSTRAINT "PageCoverage_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PageCoverageItem" ADD CONSTRAINT "PageCoverageItem_pageCoverageId_fkey" FOREIGN KEY ("pageCoverageId") REFERENCES "PageCoverage"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

