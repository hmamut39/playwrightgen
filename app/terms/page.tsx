import Link from "next/link";

import { PageSectionIndex, type PageSection } from "@/components/page-section-index";

export const metadata = {
  title: "Terms",
  description: "The terms for using PlaywrightGen.",
};

/**
 * The preview terms, as a document a reader can navigate.
 *
 * The page had a hero and five sections and no way through them: no anchors,
 * so nothing here could be linked to, and no index, so the only way to find
 * the sentence you came for was to read all of it. Terms are the page people
 * arrive at with one question.
 *
 * **The ids are written down, not derived from the titles.** A slug generated
 * from a heading changes the moment somebody edits the heading, and the link
 * a reader saved, or support sent them, stops working with nothing to show
 * that it broke. These are part of the content.
 */
const sections = [
  {
    id: "preview-status",
    title: "Preview status",
    text: "PlaywrightGen is a protected product preview for evaluating a quality-engineering workflow. It is not offered with a production uptime commitment, service-level agreement, or paid plan. Checkout remains disabled until the documented security, billing, support, legal, and release gates pass.",
  },
  {
    id: "your-responsibility",
    title: "Your responsibility",
    text: "You are responsible for reviewing generated tests, analysis, release-impact suggestions, and imported evidence before relying on them. AI output can be incomplete or wrong and is not an approval, warranty, security assessment, or substitute for engineering judgment.",
  },
  {
    id: "permitted-use",
    title: "Permitted use",
    text: "Use the preview only for lawful testing and quality work you are authorized to perform. Do not submit secrets, malicious payloads, regulated data, or repository content you are not permitted to process. Do not attempt to bypass tenant boundaries, rate limits, authentication, or provider protections.",
  },
  {
    id: "repository-and-execution-boundary",
    title: "Repository and execution boundary",
    text: "The current GitHub integration is read-only and imports configuration and test-inventory metadata for review. Imported records remain preliminary evidence. Remote repository execution and pull-request write access are not enabled in the current preview.",
  },
  {
    id: "availability-and-changes",
    title: "Availability and changes",
    text: "Preview features may change, be suspended, or be removed while the release gates are completed. Preserve your own source code and critical records. PlaywrightGen does not promise that preview data will be retained indefinitely or migrated into a future paid service.",
  },
] as const;

/** The money question is in the index, because it is the one people come for. */
const INDEX: readonly PageSection[] = [
  ...sections.map((section) => ({ id: section.id, label: section.title })),
  { id: "no-paid-purchase-today", label: "No paid purchase today" },
];

const HEADING = "scroll-mt-24 text-xl font-semibold text-slate-950";

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 text-slate-700 sm:px-6 lg:py-14">
      <section className="relative overflow-hidden rounded-[2rem] bg-slate-950 px-6 py-10 text-white shadow-xl sm:px-10 sm:py-12">
        <div className="pointer-events-none absolute right-[-8rem] top-[-10rem] h-80 w-80 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="relative">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300">
            Protected product preview
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.035em]">
            Preview terms
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300">
            These terms describe the current evaluation boundary. Production and
            paid terms require identified operator, support, jurisdiction,
            cancellation, tax, and refund decisions before launch.
          </p>
          <p className="mt-5 text-xs text-slate-400">Last updated: September 1, 2026</p>
        </div>
      </section>

      <div className="mt-10 grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
        <PageSectionIndex sections={INDEX} />

        <div className="min-w-0 space-y-6">
          {sections.map((section) => (
            <section
              key={section.id}
              className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
            >
              <h2 id={section.id} className={HEADING}>
                {section.title}
              </h2>
              <p className="mt-3 text-sm leading-7">{section.text}</p>
            </section>
          ))}

          <section className="rounded-[2rem] border border-amber-200 bg-amber-50 p-6 sm:p-8">
            <h2 id="no-paid-purchase-today" className="scroll-mt-24 font-semibold text-amber-950">
              No paid purchase today
            </h2>
            <p className="mt-2 text-sm leading-6 text-amber-900">
              The public pricing page is the current source of truth: preview
              access is free and PlaywrightGen is not accepting payment for a
              team subscription. Final cancellation and refund terms will be
              published before Checkout can be enabled.
            </p>
          </section>

          <div className="flex flex-wrap gap-4 border-t border-slate-200 pt-6 text-sm">
            <Link
              href="/privacy"
              className="inline-flex min-h-9 items-center font-semibold text-cyan-700 hover:text-cyan-600"
            >
              Privacy notice
            </Link>
            <Link
              href="/pricing"
              className="inline-flex min-h-9 items-center font-semibold text-cyan-700 hover:text-cyan-600"
            >
              Current pricing status
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
