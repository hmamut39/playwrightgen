import type { HealthVerdict } from "@/lib/services/project-health";

/** One look for a verdict wherever it appears: the Health page and project cards. */
export const HEALTH_VERDICT_STYLE = {
  attention: { label: "Needs attention", box: "border-red-200 bg-red-50", text: "text-red-900", dot: "bg-red-600" },
  "no-evidence": { label: "No evidence yet", box: "border-slate-200 bg-white", text: "text-slate-900", dot: "bg-slate-400" },
  "on-track": { label: "On track", box: "border-emerald-200 bg-emerald-50", text: "text-emerald-900", dot: "bg-emerald-600" },
} as const satisfies Record<HealthVerdict, { label: string; box: string; text: string; dot: string }>;

/** The verdict as a compact line for a card: dot, word, and why. */
export function HealthVerdictLine({ verdict, reasons }: { verdict: HealthVerdict; reasons: string[] }) {
  const style = HEALTH_VERDICT_STYLE[verdict];
  return (
    <p className={`mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-sm ${style.box} ${style.text}`}>
      <span aria-hidden className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} />
      <span className="font-semibold">{style.label}</span>
      {verdict === "attention" && reasons.length ? <span className="text-xs">{reasons.join(" · ")}</span> : null}
    </p>
  );
}
