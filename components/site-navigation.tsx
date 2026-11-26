"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { SlidingTabs } from "@/components/sliding-tabs";

const freeTools = [
  { href: "/generator", label: "Quick Generate" },
  { href: "/coverage-review", label: "Coverage Review" },
  { href: "/engineering-review", label: "Release Review" },
] as const;

/** Pages that are one task with one way forward; see the check below. */
const FOCUSED_TASKS = ["/sign-in", "/sign-up", "/onboarding"] as const;

export function SiteNavigation() {
  const pathname = usePathname();
  // Inside the workspace the product has its own navigation; the marketing
  // menu above it -- with an "Open Workspace" button to the page you are
  // already on -- was a second header that pointed people away from their work.
  if (pathname === "/workspace" || pathname.startsWith("/workspace/")) return null;
  // A shared proof link is read by someone outside the team, and it promises no
  // way into the workspace. A menu offering one would break that promise.
  if (pathname.startsWith("/proof/")) return null;
  // Signing in, signing up and naming your first organisation are each a single
  // task with one way forward. The marketing menu put six ways out above them,
  // and its "Open Workspace" button was the worst of the six: signed out it
  // leads to /workspace, which sends you back to /sign-in -- a button that
  // returns you to the page you are standing on. Onboarding is the one that
  // costs something, because a new person who wanders off it has an account
  // with no organisation and nothing to come back to.
  if (FOCUSED_TASKS.some((task) => pathname === task || pathname.startsWith(`${task}/`))) return null;
  const navigationItems = [
    { href: "/#product", label: "Product", match: "/" },
    ...freeTools.map((tool) => ({ ...tool, match: tool.href })),
    { href: "/mcp", label: "MCP", match: "/mcp" },
    { href: "/pricing", label: "Pricing", match: "/pricing" },
  ];

  return (
    <nav className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
      {/*
        * The gap and the logo both give way before the page does.
        *
        * At 360px -- a small Android, and the narrowest width worth
        * supporting -- the logo and the Open Workspace button were both
        * `shrink-0` with a 20px gap between them, so the row could not
        * compress and the document scrolled sideways by 5px instead. Every
        * page on the site did it; at 390px none of them did, which is why one
        * viewport had not caught it. Measured on 2026-11-26: the button's
        * right edge sat at x=365 in a 360px document.
        *
        * The button keeps its size because it is the action. The logo gets
        * `min-w-0` and a truncating name so the row has something to give at
        * widths below this one.
        */}
      <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:gap-5 sm:px-6 lg:px-8">
        <Link href="/" className="group flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-950 text-xs font-bold tracking-[-0.02em] text-white shadow-sm transition group-hover:bg-cyan-700">
            PG
          </span>
          <span className="min-w-0">
            <span className="block truncate text-base font-bold tracking-[-0.02em] text-slate-950">
              PlaywrightGen
            </span>
            <span className="hidden text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 sm:block">
              Quality operating system
            </span>
          </span>
        </Link>

        <SlidingTabs tabs={navigationItems} pathname={pathname} />

        <Link
          href="/workspace"
          className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-950 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-700 sm:px-4"
        >
          Open Workspace
          <span aria-hidden="true">→</span>
        </Link>
      </div>

      <div className="overflow-x-auto border-t border-slate-100 px-4 py-2 lg:hidden">
        <div className="flex min-w-max gap-1 rounded-xl bg-slate-100 p-1">
          {navigationItems.slice(1).map((item) => {
            const active = pathname === item.match;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold ${active ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:bg-white/70 hover:text-slate-950"}`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
