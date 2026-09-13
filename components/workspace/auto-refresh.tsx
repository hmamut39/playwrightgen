"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-renders the page from the server every few seconds while it is mounted.
 *
 * Used while something finishes in the background -- generated code being
 * written -- so the result appears on its own, without the person having to
 * know to reload. Each refresh is an ordinary navigation request, so it also
 * carries a freshly renewed sign-in session.
 */
export function AutoRefresh({ intervalMs = 4000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), intervalMs);
    return () => window.clearInterval(timer);
  }, [router, intervalMs]);
  return null;
}
