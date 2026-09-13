"use client";

import { useFormStatus } from "react-dom";

/**
 * A submit button that visibly responds while its form is working.
 *
 * Every AI action in the workspace -- generating automation, reviewing a
 * requirement, analyzing a failure -- runs for twenty to sixty seconds, and each
 * was a plain button that gave no sign it had been pressed. The result arrived
 * eventually, but nobody waiting can tell "working" from "broken", so they click
 * again, reload, or give up. The first report of this came from someone testing
 * the product as a customer would, which is precisely the person it fails.
 *
 * Several buttons can share one form (Browser and API generation do), so the
 * button only claims the pending label when its own name and value are the ones
 * being submitted; the rest simply disable, which stops a second request being
 * sent while the first is still running.
 */
export function PendingButton({
  children,
  pendingLabel,
  className,
  name,
  value,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  className: string;
  name?: string;
  value?: string;
}) {
  const { pending, data } = useFormStatus();
  const isThisOne = pending && (!name || data?.get(name) === value);

  return (
    <button
      name={name}
      value={value}
      disabled={pending}
      aria-busy={isThisOne}
      className={`${className} inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-70`}
    >
      {isThisOne ? (
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : null}
      {isThisOne ? pendingLabel : children}
    </button>
  );
}

/**
 * States what is happening and how long it usually takes, only while it is.
 *
 * A spinner says "wait"; this says "wait about this long, and here is what is
 * being done", which is what stops someone reloading at the fifteenth second.
 * Announced politely to screen readers, since the visual change alone would be
 * invisible to them.
 */
export function PendingNotice({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  if (!pending) return null;

  return (
    <p
      role="status"
      aria-live="polite"
      className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-600"
    >
      {children}
    </p>
  );
}
