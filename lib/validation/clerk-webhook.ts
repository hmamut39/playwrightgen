import "server-only";

import { z } from "zod";

const identifier = z.string().trim().min(1).max(255);
const nullableText = z.string().trim().min(1).nullable().optional();
const providerTimestamp = z.number().int().nonnegative();

const userDataSchema = z.object({
  id: identifier,
  primary_email_address_id: identifier.nullable(),
  email_addresses: z.array(
    z.object({
      id: identifier,
      email_address: z.string().trim().email().max(320),
    }),
  ),
  first_name: nullableText,
  last_name: nullableText,
  username: nullableText,
  image_url: z.string().trim().url().optional(),
  banned: z.boolean(),
  locked: z.boolean(),
  updated_at: providerTimestamp,
});

const organizationDataSchema = z.object({
  id: identifier,
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(100),
  created_by: identifier.optional(),
  updated_at: providerTimestamp,
});

const membershipDataSchema = z.object({
  id: identifier,
  role: z.string().trim().min(1).max(100),
  updated_at: providerTimestamp,
  organization: organizationDataSchema,
  public_user_data: z.object({
    user_id: identifier,
    first_name: nullableText,
    last_name: nullableText,
    image_url: z.string().trim().url().optional(),
  }),
  // Read leniently by the consumer; a malformed value must not reject the
  // membership itself.
  public_metadata: z.unknown().optional(),
});

const deletedObjectSchema = z.object({
  id: identifier,
  deleted: z.literal(true),
});

export const supportedClerkWebhookEventTypes = [
  "user.created",
  "user.updated",
  "user.deleted",
  "organization.created",
  "organization.updated",
  "organization.deleted",
  "organizationMembership.created",
  "organizationMembership.updated",
  "organizationMembership.deleted",
] as const;

export type SupportedClerkWebhookEventType =
  (typeof supportedClerkWebhookEventTypes)[number];

const supportedEventTypeSet = new Set<string>(
  supportedClerkWebhookEventTypes,
);

export class ClerkWebhookPayloadError extends Error {
  constructor(message = "The verified Clerk webhook payload is invalid.") {
    super(message);
    this.name = "ClerkWebhookPayloadError";
  }
}

export type NormalizedUserEvent = {
  kind: "user";
  type: "user.created" | "user.updated";
  eventId: string;
  clerkUserId: string;
  primaryEmail: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  disabled: boolean;
  updatedAt: Date;
};

export type NormalizedUserDeletedEvent = {
  kind: "user.deleted";
  type: "user.deleted";
  eventId: string;
  clerkUserId: string;
  updatedAt: Date;
};

export type NormalizedOrganizationEvent = {
  kind: "organization";
  type: "organization.created" | "organization.updated";
  eventId: string;
  clerkOrganizationId: string;
  name: string;
  slug: string;
  creatorUserId: string | null;
  updatedAt: Date;
};

export type NormalizedOrganizationDeletedEvent = {
  kind: "organization.deleted";
  type: "organization.deleted";
  eventId: string;
  clerkOrganizationId: string;
  updatedAt: Date;
};

export type NormalizedMembershipEvent = {
  kind: "membership";
  type:
    | "organizationMembership.created"
    | "organizationMembership.updated"
    | "organizationMembership.deleted";
  eventId: string;
  clerkMembershipId: string;
  clerkOrganizationId: string;
  clerkUserId: string;
  providerRole: string;
  updatedAt: Date;
  organization: {
    name: string;
    slug: string;
    creatorUserId: string | null;
    updatedAt: Date;
  };
  user: {
    displayName: string | null;
    avatarUrl: string | null;
  };
  /** Copied by Clerk from the invitation that created this membership. */
  publicMetadata: unknown;
};

export type NormalizedClerkWebhookEvent =
  | NormalizedUserEvent
  | NormalizedUserDeletedEvent
  | NormalizedOrganizationEvent
  | NormalizedOrganizationDeletedEvent
  | NormalizedMembershipEvent;

export type ParsedClerkWebhook =
  | { kind: "supported"; event: NormalizedClerkWebhookEvent }
  | { kind: "ignored" };

export function normalizeProviderTimestamp(value: unknown): Date {
  const result = providerTimestamp.safeParse(value);

  if (!result.success) {
    throw new ClerkWebhookPayloadError();
  }

  const date = new Date(result.data);
  if (Number.isNaN(date.getTime())) {
    throw new ClerkWebhookPayloadError();
  }

  return date;
}

export function selectPrimaryEmail(input: {
  primaryEmailAddressId: string | null;
  emailAddresses: ReadonlyArray<{
    id: string;
    emailAddress: string;
  }>;
}): string | null {
  if (!input.primaryEmailAddressId) {
    return null;
  }

  return (
    input.emailAddresses.find(
      (email) => email.id === input.primaryEmailAddressId,
    )?.emailAddress ?? null
  );
}

export function normalizeDisplayName(input: {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
}): string | null {
  const normalizePart = (value?: string | null) => {
    const normalized = value?.normalize("NFKC").trim().replace(/\s+/gu, " ");
    if (
      !normalized ||
      /[\u0000-\u001f\u007f-\u009f\ufffd]/u.test(normalized)
    ) {
      return null;
    }
    return normalized;
  };
  const fullName = [input.firstName, input.lastName]
    .map(normalizePart)
    .filter((part): part is string => Boolean(part))
    .join(" ");

  if (fullName) {
    return fullName.slice(0, 200);
  }

  const username = normalizePart(input.username);
  return username ? username.slice(0, 200) : null;
}

function normalizeEventId(eventId: string): string {
  const result = identifier.safeParse(eventId);
  if (!result.success) {
    throw new ClerkWebhookPayloadError(
      "The verified Clerk webhook event identifier is invalid.",
    );
  }
  return result.data;
}

function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ClerkWebhookPayloadError();
  }
  return result.data;
}

export function parseVerifiedClerkWebhook(input: {
  type: unknown;
  data: unknown;
  eventId: string;
  eventTimestamp?: unknown;
}): ParsedClerkWebhook {
  if (typeof input.type !== "string" || !supportedEventTypeSet.has(input.type)) {
    return { kind: "ignored" };
  }

  const type = input.type as SupportedClerkWebhookEventType;
  const eventId = normalizeEventId(input.eventId);

  if (type === "user.deleted") {
    const data = parseOrThrow(deletedObjectSchema, input.data);
    return {
      kind: "supported",
      event: {
        kind: "user.deleted",
        type,
        eventId,
        clerkUserId: data.id,
        updatedAt: normalizeProviderTimestamp(input.eventTimestamp),
      },
    };
  }

  if (type === "user.created" || type === "user.updated") {
    const data = parseOrThrow(userDataSchema, input.data);
    return {
      kind: "supported",
      event: {
        kind: "user",
        type,
        eventId,
        clerkUserId: data.id,
        primaryEmail: selectPrimaryEmail({
          primaryEmailAddressId: data.primary_email_address_id,
          emailAddresses: data.email_addresses.map((email) => ({
            id: email.id,
            emailAddress: email.email_address,
          })),
        }),
        displayName: normalizeDisplayName({
          firstName: data.first_name,
          lastName: data.last_name,
          username: data.username,
        }),
        avatarUrl: data.image_url ?? null,
        disabled: data.banned || data.locked,
        updatedAt: normalizeProviderTimestamp(data.updated_at),
      },
    };
  }

  if (type === "organization.deleted") {
    const data = parseOrThrow(deletedObjectSchema, input.data);
    return {
      kind: "supported",
      event: {
        kind: "organization.deleted",
        type,
        eventId,
        clerkOrganizationId: data.id,
        updatedAt: normalizeProviderTimestamp(input.eventTimestamp),
      },
    };
  }

  if (type === "organization.created" || type === "organization.updated") {
    const data = parseOrThrow(organizationDataSchema, input.data);
    return {
      kind: "supported",
      event: {
        kind: "organization",
        type,
        eventId,
        clerkOrganizationId: data.id,
        name: data.name,
        slug: data.slug,
        creatorUserId: data.created_by ?? null,
        updatedAt: normalizeProviderTimestamp(data.updated_at),
      },
    };
  }

  const data = parseOrThrow(membershipDataSchema, input.data);
  return {
    kind: "supported",
    event: {
      kind: "membership",
      type,
      eventId,
      clerkMembershipId: data.id,
      clerkOrganizationId: data.organization.id,
      clerkUserId: data.public_user_data.user_id,
      providerRole: data.role,
      updatedAt: normalizeProviderTimestamp(data.updated_at),
      organization: {
        name: data.organization.name,
        slug: data.organization.slug,
        creatorUserId: data.organization.created_by ?? null,
        updatedAt: normalizeProviderTimestamp(data.organization.updated_at),
      },
      user: {
        displayName: normalizeDisplayName({
          firstName: data.public_user_data.first_name,
          lastName: data.public_user_data.last_name,
        }),
        avatarUrl: data.public_user_data.image_url ?? null,
      },
      publicMetadata: data.public_metadata ?? null,
    },
  };
}
