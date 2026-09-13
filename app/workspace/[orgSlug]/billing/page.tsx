import { BillingActions } from "@/app/workspace/[orgSlug]/billing/billing-actions";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { getOrganizationBillingSnapshot } from "@/lib/services/billing";
import { LocalTime } from "@/components/workspace/local-time";

function label(value: string) {
  return value.toLowerCase().replaceAll("_", " ");
}

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
  const teamEntitlement = snapshot.entitlements.find(
    (entitlement) => entitlement.key === "workspace.team",
  );
  const canManage = context.can("organization:manage");
  const checkoutEnabled =
    canManage && process.env.STRIPE_CHECKOUT_ENABLED === "true";

  return (
    <div className="mx-auto max-w-5xl">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
          Organization billing
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Billing</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Subscription ownership and feature access are isolated to this organization.
        </p>
      </header>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
          <div>
            <p className="text-sm font-semibold text-slate-950">
              {teamEntitlement?.enabled ? "Team" : "Preview"}
            </p>
            <p className="mt-2 text-sm text-slate-600">
              {activeSubscription
                ? `Subscription ${label(activeSubscription.status)}.`
                : "No active paid subscription."}
            </p>
            {activeSubscription?.currentPeriodEnd ? (
              <p className="mt-1 text-xs text-slate-500">
                Current period ends <LocalTime value={activeSubscription.currentPeriodEnd} style="date" />.
              </p>
            ) : null}
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              teamEntitlement?.enabled
                ? "bg-emerald-50 text-emerald-700"
                : "bg-slate-100 text-slate-600"
            }`}
          >
            {teamEntitlement?.enabled
              ? "Team access enabled"
              : "Paid access disabled"}
          </span>
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
            An organization owner or administrator manages billing.
          </p>
        )}
      </section>

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Organization entitlements</h2>
        <div className="mt-4 divide-y divide-slate-100">
          {["workspace.team", "repository.import", "ai.workflows"].map((key) => {
            const entitlement = snapshot.entitlements.find(
              (item) => item.key === key,
            );
            return (
              <div
                key={key}
                className="flex items-center justify-between gap-4 py-3 text-sm"
              >
                <span className="font-medium text-slate-800">{key}</span>
                <span
                  className={
                    entitlement?.enabled ? "text-emerald-700" : "text-slate-500"
                  }
                >
                  {entitlement?.enabled ? "Enabled" : "Not enabled"}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
