"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const freeTools = [
  { href: "/generator", label: "Quick Generate" },
  { href: "/intelligence", label: "Coverage Review" },
  { href: "/engineering-review", label: "Release Review" },
] as const;

export function SiteNavigation() {
  const pathname = usePathname();
  // Inside the workspace the product has its own navigation; the marketing
  // menu above it -- with an "Open Workspace" button to the page you are
  // already on -- was a second header that pointed people away from their work.
  if (pathname === "/workspace" || pathname.startsWith("/workspace/")) return null;
  const navigationItems = [
    { href: "/#product", label: "Product", match: "/" },
    ...freeTools.map((tool) => ({ ...tool, match: tool.href })),
    { href: "/mcp", label: "MCP", match: "/mcp" },
    { href: "/pricing", label: "Pricing", match: "/pricing" },
  ];

  return (
    <nav className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
      <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-5 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="group flex shrink-0 items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-950 text-xs font-bold tracking-tight text-white shadow-sm transition group-hover:bg-cyan-600">
            PG
          </span>
          <span>
            <span className="block text-base font-bold tracking-[-0.02em] text-slate-950">
              PlaywrightGen
            </span>
            <span className="hidden text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 sm:block">
              Quality operating system
            </span>
          </span>
        </Link>

        <div className="hidden items-center gap-1 rounded-2xl border border-slate-200 bg-slate-100/70 p-1 lg:flex">
          {navigationItems.map((item) => {
            const active = pathname === item.match;
            return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`rounded-xl px-3.5 py-2 text-sm font-medium transition ${active ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:bg-white/70 hover:text-slate-950"}`}
            >
              {item.label}
            </Link>
            );
          })}
        </div>

        <Link
          href="/workspace"
          className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-600"
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
