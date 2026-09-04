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
  const items = [
    ["Quality", `${base}/quality`],
    ["Overview", `${base}/overview`],
    ["Requirements", `${base}/requirements`],
    ["Test Cases", `${base}/test-cases`],
    ["Automation", `${base}/automation`],
    ["Repositories", `${base}/repositories`],
    ["Test Runs", `${base}/test-runs`],
    ["Release", `${base}/release`],
  ] as const;

  return (
    <nav
      className="mb-8 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm"
      aria-label="Project"
    >
      <div className="flex min-w-max gap-1">
        {items.map(([label, href]) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`rounded-xl px-3.5 py-2 text-sm font-medium transition ${
                active
                  ? "bg-slate-950 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
