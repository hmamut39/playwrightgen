import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import Stripe from "stripe";
import { z } from "zod";

import {
  requireWorkspaceContext,
  workspaceAuthorizationErrorResponse,
} from "@/lib/auth/workspace-context";
import { getPrismaClient } from "@/lib/db/prisma";
import {
  EnvironmentValidationError,
  validateStripeCheckoutEnvironment,
} from "@/lib/env";

/**
 * Long enough to run the product against a real project and see evidence come
 * back from CI, which is the only thing that demonstrates what this costs money
 * for. A shorter trial ends before the first real run arrives.
 */
const TRIAL_DAYS = 7;

const requestSchema = z.object({
  orgSlug: z.string().trim().min(1).max(100),
});
const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(100)
  .regex(/^[A-Za-z0-9:_-]+$/);

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const context = await requireWorkspaceContext({
      orgSlug: body.orgSlug,
      permission: "organization:manage",
    });
    const config = validateStripeCheckoutEnvironment();
    const prisma = getPrismaClient();
    const stripe = new Stripe(config.STRIPE_SECRET_KEY);
    const activeSubscription = await prisma.billingSubscription.findFirst({
      where: {
        organizationId: context.organization.id,
        status: { in: ["ACTIVE", "TRIALING"] },
      },
      select: { id: true },
    });
    if (activeSubscription) {
      return NextResponse.json(
        { status: "error", code: "subscription_already_active" },
        { status: 409 },
      );
    }

    let account = await prisma.organizationBillingAccount.upsert({
      where: { organizationId: context.organization.id },
      create: { organizationId: context.organization.id },
      update: {},
    });
    if (!account.stripeCustomerId) {
      const customer = await stripe.customers.create(
        {
          name: context.organization.name,
          metadata: {
            playwrightgenOrganizationId: context.organization.id,
            playwrightgenOrganizationSlug: context.organization.slug,
          },
        },
        { idempotencyKey: `playwrightgen-customer:${context.organization.id}` },
      );
      account = await prisma.organizationBillingAccount.update({
        where: { organizationId: context.organization.id },
        data: { stripeCustomerId: customer.id },
      });
    }
    if (!account.stripeCustomerId) {
      return NextResponse.json(
        { status: "error", code: "billing_account_unavailable" },
        { status: 503 },
      );
    }

    const requestIdHeader = request.headers.get("x-idempotency-key");
    const requestId = requestIdHeader
      ? idempotencyKeySchema.parse(requestIdHeader)
      : randomUUID();
    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: account.stripeCustomerId,
        client_reference_id: context.organization.id,
        line_items: [{ price: config.STRIPE_TEAM_PRICE_ID, quantity: 1 }],
        metadata: {
          playwrightgenOrganizationId: context.organization.id,
        },
        subscription_data: {
          // Set here rather than on the Stripe price so the trial cannot be
          // lost by someone editing the price in the dashboard, and so it is
          // identical in test and live mode.
          trial_period_days: TRIAL_DAYS,
          metadata: {
            playwrightgenOrganizationId: context.organization.id,
            playwrightgenPlan: "TEAM",
          },
        },
        success_url: `${config.NEXT_PUBLIC_APP_URL}/workspace/${encodeURIComponent(context.organization.slug)}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${config.NEXT_PUBLIC_APP_URL}/workspace/${encodeURIComponent(context.organization.slug)}/billing?checkout=canceled`,
      },
      {
        idempotencyKey: `playwrightgen-checkout:${context.organization.id}:${requestId}`,
      },
    );
    if (!session.url) {
      return NextResponse.json(
        { status: "error", code: "checkout_unavailable" },
        { status: 503 },
      );
    }
    return NextResponse.json({ status: "ok", url: session.url });
  } catch (error: unknown) {
    const authorizationResponse = workspaceAuthorizationErrorResponse(error);
    if (authorizationResponse) return authorizationResponse;
    if (error instanceof EnvironmentValidationError) {
      return NextResponse.json(
        { status: "error", code: "billing_unavailable" },
        { status: 503 },
      );
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json(
        { status: "error", code: "invalid_request" },
        { status: 400 },
      );
    }
    // Stripe's own error identifiers, and nothing else. A bare "failed safely"
    // is undiagnosable in production: it cannot distinguish a wrong price id
    // from a rejected key from an account that is not activated, which is
    // exactly what an operator needs to know. The type, code and status are
    // classifiers Stripe publishes; the message is deliberately excluded
    // because it can quote back request parameters.
    const stripeError =
      typeof error === "object" && error !== null
        ? {
            type: "type" in error ? String(error.type).slice(0, 100) : null,
            code: "code" in error ? String(error.code).slice(0, 100) : null,
            statusCode:
              "statusCode" in error ? String(error.statusCode).slice(0, 10) : null,
          }
        : null;
    console.error("Stripe checkout failed safely.", stripeError);
    return NextResponse.json(
      { status: "error", code: "checkout_failed" },
      { status: 500 },
    );
  }
}
