"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function ProjectNavigation({
  organizationSlug,
  projectId,
}: {
  organizationSlug: string;
  projectId: string;
}) {
  const base = `/workspace/${organizationSlug}/projects/${projectId}`;
  const pathname = usePathname();
  // The work, in the order it happens, then the places people check on it.
  // Eleven tabs in one scrolling row cut Team and Activity off the right edge,
  // so the row now wraps and nothing is out of sight.
  const workflow = [
    ["Overview", `${base}/overview`],
    ["Requirements", `${base}/requirements`],
    ["Test Cases", `${base}/test-cases`],
    ["Automation", `${base}/automation`],
    ["Test Runs", `${base}/test-runs`],
    ["Release", `${base}/release`],
  ] as const;
  const oversight = [
    ["Reviews", `${base}/reviews`],
    ["Quality", `${base}/quality`],
    ["Repositories", `${base}/repositories`],
    ["Activity", `${base}/activity`],
    ["Team", `${base}/team`],
  ] as const;

  const link = ([label, href]: readonly [string, string]) => {
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
          active
            ? "bg-slate-950 text-white shadow-sm"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <nav
      className="mb-8 flex flex-wrap items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm"
      aria-label="Project"
    >
      {workflow.map(link)}
      <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-slate-200 sm:block" />
      {oversight.map(link)}
    </nav>
  );
}
