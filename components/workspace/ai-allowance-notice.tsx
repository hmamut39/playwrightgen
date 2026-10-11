import Link from "next/link";

import { aiAllowanceSentence, readAiAllowanceLimit } from "@/lib/operations/ai-allowance-message";

/**
 * Which notice an action refused by the workspace's AI allowance should
 * show, or null for any other failure. Server actions redirect back with it
 * as `?notice=`, so the person reads why nothing happened instead of a
 * "This page didn't load" screen.
 *
 * It used to recognise one service's error type, which left every other
 * surface to invent its own answer. It now reads the allowance wherever it
 * came from, and carries the wait so the notice can say when, not "later".
 */
export function aiAllowanceNotice(error: unknown): string | null {
  const limit = readAiAllowanceLimit(error);
  if (!limit) return null;
  const name = limit.kind === "daily" ? "ai-daily" : "ai-burst";
  return limit.retryAfterSeconds ? `${name}:${limit.retryAfterSeconds}` : name;
}

export function AiAllowanceNotice({
  notice,
  orgSlug,
  what = "Nothing was generated.",
}: {
  notice: string | undefined;
  orgSlug: string;
  /** What this surface did not do, which only it knows. */
  what?: string;
}) {
  const [name, seconds] = (notice ?? "").split(":");
  if (name !== "ai-daily" && name !== "ai-burst") return null;
  const retryAfterSeconds = Number(seconds);
  const sentence = aiAllowanceSentence({
    kind: name === "ai-daily" ? "daily" : "burst",
    ...(Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? { retryAfterSeconds } : {}),
  });
  return (
    <div role="alert" className="mt-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
      <span className="font-semibold">{what}</span> {sentence}
      {name === "ai-daily" ? (
        <>
          {" "}
          <Link href={`/workspace/${orgSlug}/billing`} className="font-semibold underline">
            The Team plan raises it.
          </Link>
        </>
      ) : null}
    </div>
  );
}
