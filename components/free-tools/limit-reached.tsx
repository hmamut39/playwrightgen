import Link from "next/link";

import { PRO_PLAN } from "@/lib/plan";

export type FreeToolLimit = {
  error: string;
  code: "burst_limit" | "daily_limit";
  plan: "TEAM" | "PUBLIC";
  retryAfterSeconds: number;
  upgrade: boolean;
};

/** Reads a 429 body from a free-tool route, or null for any other failure. */
export function readFreeToolLimit(status: number, body: unknown): FreeToolLimit | null {
  if (status !== 429 || !body || typeof body !== "object") return null;
  const value = body as Partial<FreeToolLimit>;
  if (value.code !== "daily_limit" && value.code !== "burst_limit") return null;
  return {
    error: String(value.error ?? ""),
    code: value.code,
    plan: value.plan === "TEAM" ? "TEAM" : "PUBLIC",
    retryAfterSeconds: Number(value.retryAfterSeconds ?? 0),
    upgrade: Boolean(value.upgrade),
  };
}

function waitLabel(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.max(1, Math.round((seconds % 3600) / 60));
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes} min`;
}

/**
 * What someone sees when a free tool will not run again today.
 *
 * It used to be "Too many requests. Try again later." -- an error, to the
 * person who had just used the tool five times and plainly wanted more. For a
 * visitor it is now the offer that answers that: the Team plan, with its trial
 * and what it includes. A Team customer who has used their workspace's
 * allowance is told when it resets, not sold something they already have.
 */
export function LimitReached({ limit, returnTo }: { limit: FreeToolLimit; returnTo: string }) {
  if (limit.code === "burst_limit") {
    return (
      <p role="alert" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        {limit.error || "Wait a minute before the next run."}
      </p>
    );
  }

  if (!limit.upgrade) {
    return (
      <p role="alert" className="mt-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        {limit.error} Resets in {waitLabel(limit.retryAfterSeconds)}.
      </p>
    );
  }

  return (
    <section
      role="alert"
      className="mt-5 overflow-hidden rounded-2xl border border-cyan-200 bg-white shadow-sm"
    >
      <div className="bg-slate-950 px-5 py-5 text-white sm:px-6">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-300">Free runs used for today</p>
        <h3 className="mt-1 text-xl font-semibold">Keep going with the Team plan</h3>
        <p className="mt-1 text-sm leading-6 text-slate-300">
          You&rsquo;ve used today&rsquo;s 5 free runs of this tool. Team gives your whole workspace a daily AI
          allowance for every tool, plus everything that turns drafts into evidence.
        </p>
      </div>
      <div className="px-5 py-5 sm:px-6">
        <ul className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
          {PRO_PLAN.features.slice(0, 6).map((feature) => (
            <li key={feature} className="flex gap-2">
              <span aria-hidden="true" className="text-emerald-600">&#10003;</span>
              {feature}
            </li>
          ))}
        </ul>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link
            href="/pricing"
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-5 text-sm font-bold text-white hover:bg-cyan-700"
          >
            Start {PRO_PLAN.trialLabel} &middot; then {PRO_PLAN.priceLabel}/month
          </Link>
          <Link
            href={`/sign-in?redirect_url=${encodeURIComponent(returnTo)}`}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            Already on Team? Sign in
          </Link>
        </div>
        <p className="mt-4 text-xs text-slate-500">
          Or come back tomorrow: free runs reset in {waitLabel(limit.retryAfterSeconds)} (midnight UTC).
        </p>
      </div>
    </section>
  );
}
