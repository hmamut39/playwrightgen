"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * The review decision, kept in reach on a phone.
 *
 * A reviewer reads a test case or its code to the end before deciding, and on
 * a phone that end is thousands of pixels below the Approve button in the
 * header. This bar repeats the decision at the bottom of the screen, but only
 * on small screens and only while the header's own buttons (the element with
 * `watchId`) are out of view, so the same buttons are never shown twice.
 */
export function StickyReviewBar({ watchId, label, children }: { watchId: string; label: string; children: ReactNode }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const target = document.getElementById(watchId);
    if (!target) return;
    const observer = new IntersectionObserver(([entry]) => setShow(!entry.isIntersecting));
    observer.observe(target);
    return () => observer.disconnect();
  }, [watchId]);

  if (!show) return null;
  return (
    <div
      role="region"
      aria-label="Review decision"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgba(15,23,42,0.08)] backdrop-blur lg:hidden"
    >
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-medium text-slate-700">{label}</p>
        <div className="flex shrink-0 gap-2">{children}</div>
      </div>
    </div>
  );
}
