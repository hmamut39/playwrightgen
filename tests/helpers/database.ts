import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { validateTestDatabaseEnvironment } from "@/lib/env";

const obviousProductionToken =
  /(^|[-_.])(prod|production|live)([-_.]|$)/i;
const explicitTestToken = /(^|[-_.])(test|testing)([-_.]|$)/i;

function getValidatedTestDatabaseUrl(): string {
  const { TEST_DATABASE_URL } = validateTestDatabaseEnvironment();
  const parsedUrl = new URL(TEST_DATABASE_URL);
  const databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));
  const targetIdentity = `${parsedUrl.hostname} ${databaseName}`;

  if (obviousProductionToken.test(targetIdentity)) {
    throw new Error(
      "Refusing to use TEST_DATABASE_URL because it appears to target production.",
    );
  }

  if (!explicitTestToken.test(targetIdentity)) {
    throw new Error(
      "TEST_DATABASE_URL must identify a dedicated test database using a test marker in its host or database name.",
    );
  }

  return TEST_DATABASE_URL;
}

export function createTestPrismaClient(): PrismaClient {
  const connectionString = getValidatedTestDatabaseUrl();
  const adapter = new PrismaPg({ connectionString });

  return new PrismaClient({ adapter });
}

export async function connectTestDatabase(
  client: PrismaClient,
): Promise<void> {
  await client.$connect();
}

export async function disconnectTestDatabase(
  client: PrismaClient,
): Promise<void> {
  await client.$disconnect();
}

export async function cleanPhase1ATables(
  client: PrismaClient,
): Promise<void> {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "Phase 1A database cleanup is allowed only when NODE_ENV is test.",
    );
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await client.$transaction([
        client.activity.deleteMany(),
        client.stripeWebhookDelivery.deleteMany(),
        client.organizationEntitlement.deleteMany(),
        client.billingSubscription.deleteMany(),
        client.organizationBillingAccount.deleteMany(),
        client.repositoryImportFile.deleteMany(),
        client.repositoryImport.deleteMany(),
        client.repositoryConnection.deleteMany(),
        client.gitHubWebhookDelivery.deleteMany(),
        client.gitHubInstallation.deleteMany(),
        client.failureFinding.deleteMany(),
        client.failureAnalysis.deleteMany(),
        client.testRunAttempt.deleteMany(),
        client.testRun.deleteMany(),
        client.automationArtifactVersion.deleteMany(),
        client.automationArtifact.deleteMany(),
        client.requirementTestCase.deleteMany(),
        client.testCaseImportedDraft.deleteMany(),
        client.freeToolDraft.deleteMany(),
        client.testCaseVersion.deleteMany(),
        client.testCase.deleteMany(),
        client.aiSuggestion.deleteMany(),
        client.aiRun.deleteMany(),
        client.requirementVersion.deleteMany(),
        client.requirement.deleteMany(),
        client.projectMembership.deleteMany(),
        client.project.deleteMany(),
        client.membership.deleteMany(),
        client.organization.deleteMany(),
        client.user.deleteMany(),
      ]);
      return;
    } catch (error) {
      const retryable =
        typeof error === "object" &&
        error !== null &&
        (("code" in error &&
          (error.code === "P2028" || error.code === "P2034")) ||
          ("message" in error &&
            typeof error.message === "string" &&
            error.message.includes("Unable to start a transaction")));
      if (!retryable || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}
