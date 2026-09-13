import Link from "next/link";

export const metadata = {
  title: "Terms",
  description: "The terms for using PlaywrightGen.",
};

const sections = [
  {
    title: "Preview status",
    text: "PlaywrightGen is a protected product preview for evaluating a quality-engineering workflow. It is not offered with a production uptime commitment, service-level agreement, or paid plan. Checkout remains disabled until the documented security, billing, support, legal, and release gates pass.",
  },
  {
    title: "Your responsibility",
    text: "You are responsible for reviewing generated tests, analysis, release-impact suggestions, and imported evidence before relying on them. AI output can be incomplete or wrong and is not an approval, warranty, security assessment, or substitute for engineering judgment.",
  },
  {
    title: "Permitted use",
    text: "Use the preview only for lawful testing and quality work you are authorized to perform. Do not submit secrets, malicious payloads, regulated data, or repository content you are not permitted to process. Do not attempt to bypass tenant boundaries, rate limits, authentication, or provider protections.",
  },
  {
    title: "Repository and execution boundary",
    text: "The current GitHub integration is read-only and imports configuration and test-inventory metadata for review. Imported records remain preliminary evidence. Remote repository execution and pull-request write access are not enabled in the current preview.",
  },
  {
    title: "Availability and changes",
    text: "Preview features may change, be suspended, or be removed while the release gates are completed. Preserve your own source code and critical records. PlaywrightGen does not promise that preview data will be retained indefinitely or migrated into a future paid service.",
  },
] as const;

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-700 sm:px-6 lg:py-14">
      <article className="mx-auto max-w-4xl overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
        <header className="bg-slate-950 px-6 py-10 text-white sm:px-10">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
            Protected product preview
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em]">
            Preview terms
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300">
            These terms describe the current evaluation boundary. Production and
            paid terms require identified operator, support, jurisdiction,
            cancellation, tax, and refund decisions before launch.
          </p>
          <p className="mt-5 text-xs text-slate-400">Last updated: September 1, 2026</p>
        </header>

        <div className="space-y-8 px-6 py-9 sm:px-10">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-xl font-semibold text-slate-950">{section.title}</h2>
              <p className="mt-3 text-sm leading-7">{section.text}</p>
            </section>
          ))}

          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <h2 className="font-semibold text-amber-950">No paid purchase today</h2>
            <p className="mt-2 text-sm leading-6 text-amber-900">
              The public pricing page is the current source of truth: preview
              access is free and PlaywrightGen is not accepting payment for a
              team subscription. Final cancellation and refund terms will be
              published before Checkout can be enabled.
            </p>
          </section>

          <div className="flex flex-wrap gap-3 border-t border-slate-200 pt-6 text-sm">
            <Link href="/privacy" className="font-semibold text-cyan-700 hover:text-cyan-600">
              Privacy notice
            </Link>
            <Link href="/pricing" className="font-semibold text-cyan-700 hover:text-cyan-600">
              Current pricing status
            </Link>
          </div>
        </div>
      </article>
    </main>
  );
}
