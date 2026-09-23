-- Proof links.
--
-- A read-only link that lets someone outside the team read one project's
-- evidence. The row exists so a team can stop a link before it expires; only
-- the hash of the token is kept, so the record cannot be used to rebuild the
-- link it refers to.
--
-- Additive only: one new table, its indexes and its foreign keys. Nothing
-- existing is altered.

-- CreateTable
CREATE TABLE "ProofLink" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "lastViewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProofLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProofLink_tokenHash_key" ON "ProofLink"("tokenHash");

-- CreateIndex
CREATE INDEX "ProofLink_organizationId_projectId_createdAt_idx" ON "ProofLink"("organizationId", "projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProofLink_organizationId_projectId_id_key" ON "ProofLink"("organizationId", "projectId", "id");

-- AddForeignKey
ALTER TABLE "ProofLink" ADD CONSTRAINT "ProofLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ProofLink" ADD CONSTRAINT "ProofLink_organizationId_projectId_fkey" FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ProofLink" ADD CONSTRAINT "ProofLink_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
