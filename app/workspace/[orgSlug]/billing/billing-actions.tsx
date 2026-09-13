"use client";

import { useState } from "react";

type BillingAction = "checkout" | "portal";

export function BillingActions({
  orgSlug,
  checkoutEnabled,
  hasBillingAccount,
}: {
  orgSlug: string;
  checkoutEnabled: boolean;
  hasBillingAccount: boolean;
}) {
  const [pending, setPending] = useState<BillingAction | null>(null);
  const [message, setMessage] = useState("");

  async function open(action: BillingAction) {
    setPending(action);
    setMessage("");
    try {
      const response = await fetch(
        action === "checkout" ? "/api/checkout" : "/api/billing-portal",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgSlug }),
        },
      );
      const result = (await response.json()) as {
        code?: string;
        url?: string;
      };
      if (!response.ok || !result.url) {
        setMessage(
          result.code === "billing_unavailable"
            ? "Billing is not enabled for this environment yet."
            : "Billing could not be opened. Please try again later.",
        );
        return;
      }
      window.location.assign(result.url);
    } catch {
      setMessage("Billing could not be opened. Please try again later.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      {checkoutEnabled ? (
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => void open("checkout")}
          className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending === "checkout" ? "Opening Checkout..." : "Start Team plan"}
        </button>
      ) : (
        <span className="rounded-lg bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-900">
          Upgrading is not available on this deployment yet.
        </span>
      )}
      {hasBillingAccount ? (
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => void open("portal")}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 disabled:opacity-50"
        >
          {pending === "portal" ? "Opening portal..." : "Manage billing"}
        </button>
      ) : null}
      {message ? (
        <p className="text-sm text-rose-700" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
