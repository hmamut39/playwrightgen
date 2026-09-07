"use client";

import Link from "next/link";
import { useState } from "react";

import { PRO_PLAN } from "@/lib/plan";

const plans = [
  {
    name: "Free tools",
    price: "$0",
    suffix: "No workspace required",
    description: "Reach a useful first result from the evidence you already have.",
    features: [
      "Quick Generate Playwright drafts",
      "Coverage and flaky-risk review",
      "Preliminary release-impact review",
      "Copy and download results",
      "Continue into a reviewed Workspace draft",
    ],
    cta: "Try Quick Generate",
    href: "/generator",
    featured: false,
  },
  {
    name: "Workspace preview",
    price: "$0",
    suffix: "During the product preview",
    description: "Turn disposable results into versioned, team-owned quality evidence.",
    features: [
      "Organization and project isolation",
      "Requirements and immutable versions",
      "Test Cases, traceability, and approvals",
      "Browser and API automation engines",
      "Test Runs and failure intelligence",
      "Quality Command Center",
    ],
    cta: "Open Workspace",
    href: "/workspace",
    featured: true,
  },
] as const;

export default function PricingPage() {
  const [showWaitlist, setShowWaitlist] = useState(false);
  const [email, setEmail] = useState("");
  const [waitlistLoading, setWaitlistLoading] = useState(false);
  const [waitlistMessage, setWaitlistMessage] = useState("");

  async function joinWaitlist() {
    if (!email.trim()) {
      setWaitlistMessage("Enter an email address first.");
      return;
    }
    try {
      setWaitlistLoading(true);
      setWaitlistMessage("");
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      if (!response.ok) {
        setWaitlistMessage(data.error || "The waitlist request failed.");
        return;
      }
      setWaitlistMessage("You are on the team-access waitlist.");
      setEmail("");
    } catch {
      setWaitlistMessage("The waitlist request failed. Please try again.");
    } finally {
      setWaitlistLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <div className="mx-auto max-w-6xl">
        <header className="overflow-hidden rounded-[2rem] border border-slate-800 bg-slate-950 px-6 py-9 text-white shadow-xl shadow-slate-200/70 sm:px-9 sm:py-12">
          <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
            <div className="max-w-3xl">
              <span className="inline-flex rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-200">
                Public product preview
              </span>
              <h1 className="mt-6 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
                Start free. Pay only when the team platform is production-ready.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
                PlaywrightGen does not sell unsupported promises. Free tools and
                Workspace preview access remain available while GitHub, isolated
                execution, observability, and billing gates are completed.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 text-sm text-slate-300 lg:max-w-xs">
              <p className="font-semibold text-white">No surprise checkout</p>
              <p className="mt-2 leading-6">
                Team pricing will be published with real entitlements, runner limits,
                and production support terms.
              </p>
            </div>
          </div>
        </header>

        <section className="mt-6 grid gap-4 lg:grid-cols-2" aria-label="Available plans">
          {plans.map((plan) => (
            <article
              key={plan.name}
              className={`rounded-[1.75rem] border p-6 shadow-sm sm:p-8 ${
                plan.featured
                  ? "border-cyan-300 bg-cyan-50/70"
                  : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-950">{plan.name}</p>
                  <div className="mt-4 flex items-end gap-3">
                    <p className="text-4xl font-semibold tracking-[-0.04em] text-slate-950">{plan.price}</p>
                    <p className="pb-1 text-xs font-medium text-slate-500">{plan.suffix}</p>
                  </div>
                </div>
                {plan.featured ? (
                  <span className="rounded-full bg-cyan-600 px-3 py-1 text-xs font-semibold text-white">
                    Best product experience
                  </span>
                ) : null}
              </div>
              <p className="mt-5 text-sm leading-6 text-slate-600">{plan.description}</p>
              <ul className="mt-6 space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-3 text-sm text-slate-700">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-slate-950 text-[10px] font-bold text-white">
                      ✓
                    </span>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <Link
                href={plan.href}
                className={`mt-8 inline-flex min-h-11 w-full items-center justify-center rounded-xl px-5 text-sm font-semibold transition ${
                  plan.featured
                    ? "bg-cyan-600 text-white hover:bg-cyan-500"
                    : "border border-slate-300 bg-white text-slate-800 hover:border-cyan-300 hover:bg-cyan-50"
                }`}
              >
                {plan.cta}
              </Link>
            </article>
          ))}
        </section>

        {/* The waitlist card this replaces was honest when written: it refused
            to name a price before the entitlements existed. They exist now --
            CI ingestion, evidence reports, automatic failure analysis -- so the
            price is stated, and the promise that pricing would arrive with real
            entitlements is kept rather than quietly dropped. */}
        <section className="mt-4 rounded-[1.75rem] border border-slate-900 bg-slate-950 p-6 text-white shadow-sm sm:p-8">
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-start">
            <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold">{PRO_PLAN.name}</p>
                <span className="rounded-full bg-cyan-400/15 px-2.5 py-1 text-xs font-medium text-cyan-200">
                  {PRO_PLAN.trialLabel}
                </span>
              </div>
              <p className="mt-3 text-4xl font-bold tracking-tight">
                {PRO_PLAN.priceLabel}
                <span className="ml-2 text-sm font-normal text-slate-400">
                  {PRO_PLAN.intervalLabel}
                </span>
              </p>
              <ul className="mt-5 grid gap-2 text-sm leading-6 text-slate-300 sm:grid-cols-2">
                {PRO_PLAN.features.map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <span aria-hidden="true" className="text-cyan-300">✓</span>
                    {feature}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs leading-5 text-slate-400">
                Cancel at any time during the trial and you are charged nothing.
                Your evidence stays yours either way: a workspace that stops
                paying returns to the free allowance rather than losing the
                records it created.
              </p>
            </div>
            <Link
              href="/workspace"
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-white px-5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100"
            >
              Start the {PRO_PLAN.trialLabel.toLowerCase()}
            </Link>
          </div>
        </section>
      </div>

      {showWaitlist ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 px-4 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="waitlist-title" className="w-full max-w-md rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-2xl">
            <span className="inline-flex rounded-full bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700">Team + CI</span>
            <h2 id="waitlist-title" className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-slate-950">Join the product waitlist</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Get launch updates when GitHub, runners, entitlements, and support are ready for real teams.
            </p>
            <label className="mt-5 block text-sm font-medium text-slate-800">
              Email address
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
              />
            </label>
            {waitlistMessage ? <p className="mt-3 text-sm text-slate-600" role="status">{waitlistMessage}</p> : null}
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => setShowWaitlist(false)} className="min-h-11 flex-1 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">Close</button>
              <button type="button" onClick={joinWaitlist} disabled={waitlistLoading} className="min-h-11 flex-1 rounded-xl bg-cyan-600 px-4 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50">
                {waitlistLoading ? "Joining…" : "Join waitlist"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
