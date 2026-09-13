"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The workspace's own links, highlighting the one you are on.
 *
 * "Projects" was drawn as selected on every page, Billing included, so the
 * sidebar could not answer "where am I". A row on phones, a column beside the
 * page on wider screens.
 */
export function WorkspaceLinks({ organizationSlug }: { organizationSlug: string }) {
  const pathname = usePathname();
  const base = `/workspace/${organizationSlug}`;
  const links = [
    { label: "Projects", href: base, active: pathname === base || pathname.startsWith(`${base}/projects`) },
    { label: "Billing", href: `${base}/billing`, active: pathname.startsWith(`${base}/billing`) },
  ];

  return (
    <nav
      aria-label="Workspace"
      className="mt-3 flex gap-1 border-t border-slate-800 pt-3 lg:mt-8 lg:block lg:space-y-2 lg:pt-5"
    >
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={link.active ? "page" : undefined}
          className={`block rounded-lg px-3 py-2 text-sm font-medium transition lg:py-2.5 ${
            link.active
              ? "bg-slate-800 text-white"
              : "text-slate-300 hover:bg-slate-800 hover:text-white"
          }`}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
