-- Somebody outside the team accepting the evidence in front of them.
--
-- Every audit chain ends at a person saying "yes, this is acceptable", and in
-- most teams that moment happens in a meeting or an email and is never
-- recorded. A proof link already puts the evidence in front of that person;
-- this keeps their answer next to it.
--
-- The name is what the signer typed: the product does not know who held the
-- link, so the record says a named person accepted this evidence, not that
-- their identity was verified. The strength is that the link was sent to
-- someone, expires, can be stopped, and the signature is bound to the exact
-- evidence by its hash and a copy of what was signed.
--
-- Additive only: one new table.

CREATE TABLE "EvidenceSignature" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "proofLinkId" UUID NOT NULL,
    "signedName" VARCHAR(120) NOT NULL,
    "signedRole" VARCHAR(120),
    "note" TEXT,
    "evidenceHash" VARCHAR(64) NOT NULL,
    "evidence" JSONB NOT NULL,
    "signedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceSignature_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EvidenceSignature_organizationId_projectId_signedAt_idx" ON "EvidenceSignature"("organizationId", "projectId", "signedAt");
CREATE INDEX "EvidenceSignature_proofLinkId_idx" ON "EvidenceSignature"("proofLinkId");

ALTER TABLE "EvidenceSignature" ADD CONSTRAINT "EvidenceSignature_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "EvidenceSignature" ADD CONSTRAINT "EvidenceSignature_organizationId_projectId_fkey" FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "EvidenceSignature" ADD CONSTRAINT "EvidenceSignature_organizationId_projectId_proofLinkId_fkey" FOREIGN KEY ("organizationId", "projectId", "proofLinkId") REFERENCES "ProofLink"("organizationId", "projectId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
