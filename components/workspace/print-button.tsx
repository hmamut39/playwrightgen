"use client";

/**
 * Prints the current page.
 *
 * A real button rather than decoration: the report exists to be attached to a
 * ticket or carried into a meeting, and asking someone to remember a keyboard
 * shortcut is how a feature goes unused. The browser's own print dialog is
 * still there for anyone who prefers it, so nothing depends on this.
 */
export function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
    >
      {label}
    </button>
  );
}
