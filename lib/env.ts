import "server-only";

import { z } from "zod";

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

const requiredValue = z.string().trim().min(1);
const httpUrl = requiredValue.url().refine(
  (value) => value.startsWith("http://") || value.startsWith("https://"),
  "Must be an HTTP(S) URL.",
);
const postgresUrl = requiredValue.refine(
  (value) => /^postgres(?:ql)?:\/\//i.test(value),
  "Must be a PostgreSQL connection URL.",
);

export const databaseEnvironmentSchema = z.object({
  DATABASE_URL: postgresUrl,
});

export const migrationEnvironmentSchema = z.object({
  DATABASE_URL: postgresUrl,
  DIRECT_URL: postgresUrl.optional(),
});

export const testDatabaseEnvironmentSchema = z.object({
  TEST_DATABASE_URL: postgresUrl,
});

export const publicClerkEnvironmentSchema = z.object({
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: requiredValue,
});

export const serverClerkEnvironmentSchema = z.object({
  CLERK_SECRET_KEY: requiredValue,
});

export const clerkWebhookEnvironmentSchema = z.object({
  CLERK_WEBHOOK_SIGNING_SECRET: requiredValue,
});

export const githubAppAuthenticationEnvironmentSchema = z.object({
  GITHUB_APP_ID: requiredValue.regex(/^\d+$/),
  GITHUB_APP_PRIVATE_KEY: requiredValue,
});

export const githubWebhookEnvironmentSchema = z.object({
  GITHUB_WEBHOOK_SECRET: requiredValue,
});

export const runnerIngestEnvironmentSchema = z.object({
  RUNNER_INGEST_SECRET: requiredValue.min(32),
});

export const githubSetupEnvironmentSchema =
  githubAppAuthenticationEnvironmentSchema.extend({
    GITHUB_APP_SLUG: requiredValue.regex(/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/),
    GITHUB_APP_CLIENT_ID: requiredValue,
    GITHUB_APP_CLIENT_SECRET: requiredValue,
    GITHUB_SETUP_STATE_SECRET: requiredValue.min(32),
    NEXT_PUBLIC_APP_URL: httpUrl,
  });

export const stripeClientEnvironmentSchema = z.object({
  STRIPE_SECRET_KEY: requiredValue,
});

export const stripeCheckoutEnvironmentSchema =
  stripeClientEnvironmentSchema.extend({
    STRIPE_TEAM_PRICE_ID: requiredValue,
    STRIPE_CHECKOUT_ENABLED: z.literal("true"),
    STRIPE_ENVIRONMENT: z.enum(["test", "live"]),
    NEXT_PUBLIC_APP_URL: httpUrl,
  });

export const stripePortalEnvironmentSchema =
  stripeClientEnvironmentSchema.extend({
    NEXT_PUBLIC_APP_URL: httpUrl,
  });

export const redisEnvironmentSchema = z.object({
  UPSTASH_REDIS_REST_URL: httpUrl,
  UPSTASH_REDIS_REST_TOKEN: requiredValue,
});

export const openAiEnvironmentSchema = z.object({
  OPENAI_API_KEY: requiredValue,
});

export const resendEnvironmentSchema = z.object({
  RESEND_API_KEY: requiredValue,
});

export const stripeWebhookEnvironmentSchema =
  stripeClientEnvironmentSchema.extend({
    STRIPE_WEBHOOK_SECRET: requiredValue,
    STRIPE_TEAM_PRICE_ID: requiredValue,
    STRIPE_ENVIRONMENT: z.enum(["test", "live"]),
  });

export class EnvironmentValidationError extends Error {
  readonly variableNames: readonly string[];

  constructor(scope: string, variableNames: readonly string[]) {
    super(
      `Invalid ${scope} environment configuration. Check: ${variableNames.join(", ")}.`,
    );
    this.name = "EnvironmentValidationError";
    this.variableNames = variableNames;
  }
}

function validateEnvironment<TSchema extends z.ZodType>(
  schema: TSchema,
  source: EnvironmentSource,
  scope: string,
): z.output<TSchema> {
  const result = schema.safeParse(source);

  if (!result.success) {
    const variableNames = Array.from(
      new Set(
        result.error.issues
          .map((issue) => issue.path[0])
          .filter(
            (segment): segment is string => typeof segment === "string",
          ),
      ),
    ).sort();

    throw new EnvironmentValidationError(
      scope,
      variableNames.length > 0 ? variableNames : ["required variables"],
    );
  }

  return result.data;
}

export function validateDatabaseEnvironment(
  source: EnvironmentSource = process.env,
) {
  return validateEnvironment(
    databaseEnvironmentSchema,
    source,
    "database",
  );
}

export function validateMigrationEnvironment(
  source: EnvironmentSource = process.env,
) {
  return validateEnvironment(
    migrationEnvironmentSchema,
    source,
    "database migration",
  );
}

export function validateTestDatabaseEnvironment(
  source: EnvironmentSource = process.env,
) {
  return validateEnvironment(
    testDatabaseEnvironmentSchema,
    source,
    "test database",
  );
}

export function validatePublicClerkEnvironment(
  source: EnvironmentSource = process.env,
) {
  return validateEnvironment(
    publicClerkEnvironmentSchema,
    source,
    "public Clerk",
  );
}

export function validateServerClerkEnvironment(
  source: EnvironmentSource = process.env,
) {
  return validateEnvironment(
    serverClerkEnvironmentSchema,
    source,
    "server Clerk",
  );
}

export function validateClerkWebhookEnvironment(
  source: EnvironmentSource = process.env,
) {
  return validateEnvironment(
    clerkWebhookEnvironmentSchema,
    source,
    "Clerk webhook",
  );
}

export function validateGitHubAppAuthenticationEnvironment(
  source: EnvironmentSource = process.env,
) {
  return validateEnvironment(
    githubAppAuthenticationEnvironmentSchema,
    source,
    "GitHub App authentication",
  );
}

export function validateGitHubWebhookEnvironment(
  source: EnvironmentSource = process.env,
) {
  return validateEnvironment(
    githubWebhookEnvironmentSchema,
    source,
    "GitHub webhook",
  );
}

export function validateRunnerIngestEnvironment(
  source: EnvironmentSource = process.env,
) {
  return validateEnvironment(
    runnerIngestEnvironmentSchema,
    source,
    "runner ingest",
  );
}

export function validateGitHubSetupEnvironment(
  source: EnvironmentSource = process.env,
) {
  return validateEnvironment(
    githubSetupEnvironmentSchema,
    source,
    "GitHub App setup",
  );
}

export function validateStripeClientEnvironment(
  source: EnvironmentSource = process.env,
) {
  return validateEnvironment(
    stripeClientEnvironmentSchema,
    source,
    "Stripe client",
  );
}

export function validateStripeCheckoutEnvironment(
  source: EnvironmentSource = process.env,
) {
  return validateEnvironment(
    stripeCheckoutEnvironmentSchema,
    source,
    "Stripe checkout",
  );
}

export function validateStripePortalEnvironment(
  source: EnvironmentSource = process.env,
) {
  return validateEnvironment(
    stripePortalEnvironmentSchema,
    source,
    "Stripe customer portal",
  );
}

export function validateRedisEnvironment(
  source: EnvironmentSource = process.env,
) {
  return validateEnvironment(redisEnvironmentSchema, source, "Upstash Redis");
}

export function validateOpenAiEnvironment(
  source: EnvironmentSource = process.env,
) {
  return validateEnvironment(openAiEnvironmentSchema, source, "OpenAI");
}

export function validateResendEnvironment(
  source: EnvironmentSource = process.env,
) {
  return validateEnvironment(resendEnvironmentSchema, source, "Resend");
}

export function validateStripeWebhookEnvironment(
  source: EnvironmentSource = process.env,
) {
  return validateEnvironment(
    stripeWebhookEnvironmentSchema,
    source,
    "Stripe webhook",
  );
}
