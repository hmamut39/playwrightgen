import {
  OrganizationSwitcher,
  UserButton,
} from "@clerk/nextjs";
import Link from "next/link";

import { WorkspaceLinks } from "@/components/workspace/workspace-links";

/**
 * The workspace chrome: a sidebar on wide screens, a compact bar on phones.
 *
 * On a phone the sidebar used to stack above the page at full size -- logo,
 * switcher, a column of links, and the workspace name twice more -- so the
 * first screen someone saw held no content at all. On small screens it is now
 * one bar: logo, workspace, account, and the links in a single row.
 */
export function WorkspaceFrame({
  children,
  organizationName,
  organizationSlug,
}: {
  children: React.ReactNode;
  organizationName: string;
  organizationSlug: string;
}) {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950 lg:flex">
      <aside className="border-b border-slate-800 bg-slate-950 px-4 py-3 text-white lg:min-h-screen lg:w-72 lg:border-b-0 lg:border-r lg:px-5 lg:py-7">
        <div className="flex items-center justify-between gap-3 lg:block">
          <Link href={`/workspace/${organizationSlug}`} className="flex shrink-0 items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-xs font-bold text-slate-950 lg:h-10 lg:w-10">PG</span>
            <span className="hidden sm:block">
              <span className="block font-semibold">PlaywrightGen</span>
              <span className="block text-xs text-slate-400">Quality workspace</span>
            </span>
          </Link>
          <div className="flex min-w-0 items-center gap-2 lg:mt-8 lg:block">
            <div className="min-w-0">
              {/* Styled for the dark sidebar: Clerk's default draws dark text,
                  which left the workspace name unreadable here. */}
              <OrganizationSwitcher
                afterCreateOrganizationUrl="/workspace"
                afterSelectOrganizationUrl="/workspace"
                hidePersonal
                appearance={{
                  elements: {
                    // Important modifiers: Clerk's own styles otherwise win over
                    // Tailwind's layered utilities, which is why the name stayed dark.
                    rootBox: "w-full",
                    organizationSwitcherTrigger:
                      "w-full! justify-between! rounded-xl! border! border-slate-700! bg-slate-800! px-3! py-2! text-white! shadow-none! hover:bg-slate-700! focus-visible:ring-2 focus-visible:ring-sky-400",
                    organizationPreviewMainIdentifier: "text-sm! font-medium! text-white! truncate!",
                    organizationPreviewSecondaryIdentifier: "text-xs! text-slate-400!",
                    organizationSwitcherTriggerIcon: "text-slate-400!",
                  },
                }}
              />
            </div>
            <span className="shrink-0 lg:hidden">
              <UserButton />
            </span>
          </div>
        </div>
        <WorkspaceLinks organizationSlug={organizationSlug} />
        <div className="mt-5 hidden items-center justify-between border-t border-slate-800 pt-5 lg:fixed lg:bottom-7 lg:flex lg:w-60">
          <span className="truncate pr-3 text-sm text-slate-300">{organizationName}</span>
          <UserButton />
        </div>
      </aside>
      <section className="min-w-0 flex-1">
        <header className="hidden border-b border-slate-200 bg-white px-5 py-4 sm:px-8 lg:block">
          <p className="text-sm font-medium text-slate-700">{organizationName}</p>
        </header>
        <div className="px-4 py-6 sm:px-8 sm:py-8 lg:px-10">{children}</div>
      </section>
    </main>
  );
}
