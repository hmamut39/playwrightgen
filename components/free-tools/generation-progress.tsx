"use client";

import { useEffect, useState } from "react";

/**
 * Progress shown while a free tool waits on the model.
 *
 * These calls take roughly thirty to sixty seconds. A disabled button and no
 * other movement is indistinguishable from a hang, and people reload or leave
 * long before the answer arrives. An elapsed counter is the cheapest possible
 * proof that something is still happening.
 *
 * The expectation is stated up front rather than hidden: someone who knows it
 * takes about a minute will wait, and someone who does not will not.
 *
 * `role="status"` with `aria-live="polite"` announces it to screen readers
 * without interrupting, and the bar honours reduced-motion.
 */
export function GenerationProgress({
  message,
  steps,
}: {
  message: string;
  steps: string[];
}) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section
      role="status"
      aria-live="polite"
      className="mt-8 rounded-[2rem] border border-cyan-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-cyan-100">
        <div className="h-full w-2/3 animate-pulse rounded-full bg-cyan-600 motion-reduce:animate-none" />
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-slate-900">{message}</p>
        <p className="text-xs tabular-nums text-slate-500">
          {seconds}s elapsed · usually 30–60s
        </p>
      </div>

      <ul className="mt-4 grid gap-2">
        {steps.map((step) => (
          <li key={step} className="flex gap-2 text-xs leading-5 text-slate-600">
            <span aria-hidden="true" className="text-cyan-600">
              •
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-xs leading-5 text-slate-400">
        Structured output is validated locally before it is shown, so nothing
        appears until it has passed those checks.
      </p>
    </section>
  );
}
