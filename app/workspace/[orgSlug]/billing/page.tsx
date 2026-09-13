import { BillingActions } from "@/app/workspace/[orgSlug]/billing/billing-actions";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { getOrganizationBillingSnapshot } from "@/lib/services/billing";
import { LocalTime } from "@/components/workspace/local-time";
import { PRO_PLAN } from "@/lib/plan";
import { AI_WORKFLOWS_ENTITLEMENT, FREE_LIMITS, TEAM_LIMITS } from "@/lib/services/entitlements";

/**
 * What this workspace pays for and what that gives it.
 *
 * The page showed internal entitlement keys ("workspace.team",
 * "ai.workflows") and called the free state "Preview", which told nobody what
 * they had or what upgrading would change. It now names the plan, the daily
 * AI allowance that actually differs between plans, and a trial's end date.
 */

export default async function BillingPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const context = await requireWorkspaceContext({ orgSlug });
  const snapshot = await getOrganizationBillingSnapshot({
    organizationId: context.organization.id,
  });
  const activeSubscription = snapshot.subscriptions.find((subscription) =>
    ["ACTIVE", "TRIALING"].includes(subscription.status),
  );
  const onTeam = Boolean(
    snapshot.entitlements.find((entitlement) => entitlement.key === AI_WORKFLOWS_ENTITLEMENT)?.enabled,
  );
  const limits = onTeam ? TEAM_LIMITS : FREE_LIMITS;
  const canManage = context.can("organization:manage");
  const checkoutEnabled =
    canManage && process.env.STRIPE_CHECKOUT_ENABLED === "true";

  return (
    <div className="mx-auto max-w-5xl">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Workspace</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Plan and billing</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          One plan covers the whole workspace: every project and every member.
        </p>
      </header>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Current plan</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950">{onTeam ? "Team" : "Free"}</p>
            <p className="mt-2 text-sm text-slate-600">
              {activeSubscription?.status === "TRIALING"
                ? "Free trial in progress."
                : activeSubscription
                  ? `${PRO_PLAN.priceLabel} ${PRO_PLAN.intervalLabel}.`
                  : "No subscription. Everything in the workspace works; AI use has a smaller daily allowance."}
            </p>
            {activeSubscription?.currentPeriodEnd ? (
              <p className="mt-1 text-xs text-slate-500">
                {activeSubscription.status === "TRIALING" ? "Trial ends" : "Renews"}{" "}
                <LocalTime value={activeSubscription.currentPeriodEnd} style="date" />.
              </p>
            ) : null}
          </div>
          <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">AI allowance</p>
            <p className="mt-1 font-semibold text-slate-900">{limits.aiDailyLimit} AI actions per day</p>
            <p className="text-xs text-slate-500">shared by the whole workspace</p>
          </div>
        </div>

        {canManage ? (
          <div className="mt-6 border-t border-slate-200 pt-6">
            <BillingActions
              orgSlug={orgSlug}
              checkoutEnabled={checkoutEnabled}
              hasBillingAccount={Boolean(snapshot.account?.stripeCustomerId)}
            />
          </div>
        ) : (
          <p className="mt-6 border-t border-slate-200 pt-6 text-sm text-slate-500">
            The workspace owner or an admin manages the plan.
          </p>
        )}
      </section>

      {!onTeam ? (
        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">
            Team plan &middot; {PRO_PLAN.priceLabel} <span className="text-sm font-normal text-slate-500">{PRO_PLAN.intervalLabel}</span>
          </h2>
          <ul className="mt-4 space-y-2 text-sm text-slate-700">
            {PRO_PLAN.features.map((feature) => (
              <li key={feature} className="flex gap-2">
                <span aria-hidden="true" className="text-emerald-600">&#10003;</span>
                {feature}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
