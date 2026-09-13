import {
  OrganizationSwitcher,
  UserButton,
} from "@clerk/nextjs";
import Link from "next/link";

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
      <aside className="border-b border-slate-800 bg-slate-950 px-5 py-5 text-white lg:min-h-screen lg:w-72 lg:border-b-0 lg:border-r lg:py-7">
        <div className="flex items-center justify-between gap-4 lg:block">
          <Link href={`/workspace/${organizationSlug}`} className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-xs font-bold text-slate-950">PG</span>
            <span>
              <span className="block font-semibold">PlaywrightGen</span>
              <span className="block text-xs text-slate-400">Quality workspace</span>
            </span>
          </Link>
          <div className="lg:mt-8">
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
                    "w-full! justify-between! rounded-xl! border! border-slate-700! bg-slate-800! px-3! py-2.5! text-white! shadow-none! hover:bg-slate-700! focus-visible:ring-2 focus-visible:ring-sky-400",
                  organizationPreviewMainIdentifier: "text-sm! font-medium! text-white!",
                  organizationPreviewSecondaryIdentifier: "text-xs! text-slate-400!",
                  organizationSwitcherTriggerIcon: "text-slate-400!",
                },
              }}
            />
          </div>
        </div>
        <nav className="mt-5 border-t border-slate-800 pt-5 lg:mt-8">
          <Link
            href={`/workspace/${organizationSlug}`}
            className="block rounded-lg bg-slate-800 px-3 py-2.5 text-sm font-medium"
          >
            Projects
          </Link>
          <Link
            href={`/workspace/${organizationSlug}/billing`}
            className="mt-2 block rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white"
          >
            Billing
          </Link>
        </nav>
        <div className="mt-5 flex items-center justify-between border-t border-slate-800 pt-5 lg:mt-auto lg:fixed lg:bottom-7 lg:w-60">
          <span className="truncate pr-3 text-sm text-slate-300">{organizationName}</span>
          <UserButton />
        </div>
      </aside>
      <section className="min-w-0 flex-1">
        <header className="border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
          <p className="text-sm font-medium text-slate-700">{organizationName}</p>
        </header>
        <div className="px-5 py-8 sm:px-8 lg:px-10">{children}</div>
      </section>
    </main>
  );
}
