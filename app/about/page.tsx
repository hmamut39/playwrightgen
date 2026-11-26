import type { Metadata } from "next";
import Link from "next/link";

import { PageSectionIndex, type PageSection } from "@/components/page-section-index";
import { SITE_AUTHOR, SITE_NAME, SITE_PURPOSE } from "@/lib/site";
import {
  OWASP_CHECKED_ON,
  OWASP_EDITION,
  OWASP_POSTURE,
  OWASP_POSTURE_LIMITS,
  OWASP_SOURCE,
} from "@/lib/security/owasp-posture";

/**
 * Who made PlaywrightGen, and what it is for.
 *
 * The site explained what the product does on every page and never once said
 * who wrote it. Somebody asking a search engine or an assistant found no
 * answer here, so the answer came from elsewhere or did not come at all. This
 * page is the one a person is sent to and the one a crawler quotes, so it says
 * both plainly and in the first paragraph rather than in a byline at the
 * bottom.
 *
 * **Why it looks like the rest of the site now.** Measured on 2026-11-26
 * across every public page: the home page, /generator, /coverage-review,
 * /mcp, /pricing and /engineering-review all share one language -- a dark
 * hero panel, a small uppercase eyebrow, a grid of rounded cards. This page
 * had none of it. It was a bare column of text, which on the page a stranger
 * is sent to and a crawler quotes reads as the part nobody finished. The
 * words are unchanged; only their presentation is.
 */

export const metadata: Metadata = {
  title: "About",
  description: `${SITE_NAME} is built by ${SITE_AUTHOR.name} (${SITE_AUTHOR.alternateName}). ${SITE_PURPOSE}`,
  alternates: { canonical: "/about" },
  openGraph: {
    title: `About ${SITE_NAME}`,
    description: `${SITE_NAME} is built by ${SITE_AUTHOR.name} (${SITE_AUTHOR.alternateName}).`,
    url: "/about",
  },
};

/** 2026-11-21 as "21 November 2026", for a sentence rather than a log line. */
function readable(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

const SECTIONS: readonly PageSection[] = [
  { id: "what-it-is-for", label: "What it is for" },
  { id: "what-it-will-not-do", label: "What it will not do" },
  { id: "how-it-is-secured", label: "How it is secured" },
  { id: "contact", label: "Contact" },
];

/**
 * `scroll-mt-24` on every heading an anchor points at.
 *
 * The site header is `sticky top-0`, so a browser jumping to a heading puts it
 * exactly underneath the header and the reader lands on a section whose title
 * they cannot see. The margin is what the index in the left column is worth.
 */
const HEADING = "scroll-mt-24 text-2xl font-semibold tracking-[-0.035em] text-slate-950";
const CARD = "rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8";
const BODY = "mt-4 text-base leading-7 text-slate-700";

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10 sm:py-14">
      <section className="relative overflow-hidden rounded-[2rem] bg-slate-950 px-6 py-10 text-white shadow-xl sm:px-9 sm:py-12 lg:px-12">
        <div className="pointer-events-none absolute right-[-8rem] top-[-10rem] h-80 w-80 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="relative">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-300">Who made this</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">
            About {SITE_NAME}
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-300">
            {SITE_NAME} is built by{" "}
            <a
              href={SITE_AUTHOR.url}
              rel="author noreferrer"
              target="_blank"
              className="font-semibold text-white underline underline-offset-4"
            >
              {SITE_AUTHOR.name}
            </a>
            , who also goes by {SITE_AUTHOR.alternateName}. It is an independent
            product, designed and written by one person rather than a company.
          </p>
          <div className="mt-8 flex flex-wrap gap-3 text-sm">
            <Link
              href="/"
              className="inline-flex min-h-11 items-center rounded-xl bg-cyan-400 px-4 font-semibold text-slate-950 transition hover:bg-cyan-300"
            >
              See what it does
            </Link>
            <Link
              href="/generator"
              className="inline-flex min-h-11 items-center rounded-xl border border-white/20 bg-white/5 px-4 font-semibold text-white transition hover:bg-white/10"
            >
              Try it without an account
            </Link>
          </div>
        </div>
      </section>

      <div className="mt-10 grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
        <PageSectionIndex sections={SECTIONS} />

        <div className="min-w-0 space-y-8">
          <section className={CARD}>
            <h2 id="what-it-is-for" className={HEADING}>
              What it is for
            </h2>
            <p className={BODY}>{SITE_PURPOSE}</p>
            <p className={BODY}>
              Writing an end-to-end test is the part everybody automates. The
              part that decides whether a release is safe is quieter: which
              requirement a test belongs to, who approved it, which version of
              it last ran, whether that run was yesterday or in March, and
              whether anybody outside the team ever accepted the result.{" "}
              {SITE_NAME} keeps that chain, and refuses to round it up.
            </p>
          </section>

          <section className={CARD}>
            <h2 id="what-it-will-not-do" className={HEADING}>
              What it will not do
            </h2>
            <p className={BODY}>
              It does not call a test proven when the run was partly skipped. It
              does not call a project releasable, because that is a judgement a
              person makes. It will not repair a failing test whose failure
              looks like a real defect in the product, because quietly fixing
              the test would delete the only warning anybody was going to get.
              Where it has counted only part of a project, it says so, on every
              page and in every file it produces.
            </p>
            <p className={BODY}>
              Your tests run on your own machines, in your own CI, against your
              own environment. {SITE_NAME} never executes your code and never
              receives your repository contents &mdash; only a bounded summary
              of results.
            </p>
          </section>

          {/*
            * What is done about each risk on the current OWASP list, and what
            * is not.
            *
            * On this page rather than a new one, because a security page
            * nobody links to is a security page nobody reads, and because
            * every claim here is of the same kind as the two sections above
            * it: something this product does or refuses to do. The claims
            * that can be checked are checked by
            * tests/unit/owasp-posture.test.ts against the code that makes
            * them true, so a sentence here cannot outlive its implementation
            * -- which is how three files came to state one sending address
            * and one setting moved only one of them.
            */}
          <section className={CARD}>
            <h2 id="how-it-is-secured" className={HEADING}>
              How it is secured
            </h2>
            <p className={BODY}>
              Mapped against the{" "}
              <a
                href={OWASP_SOURCE}
                rel="noreferrer"
                target="_blank"
                className="font-medium text-slate-950 underline underline-offset-4"
              >
                {OWASP_EDITION}
              </a>
              , read on {readable(OWASP_CHECKED_ON)}. Where there is nothing in
              place, it says so in the same voice as the rest.
            </p>

            {/*
              * One card per risk, two across where there is room.
              *
              * Ten risks as a flat run of headings was a wall a reader had to
              * scan linearly to find the one they came for. A card has an
              * edge, so the eye can skip the nine it does not need -- and the
              * "Not done" note stays inside the card it belongs to instead of
              * floating between two sections.
              */}
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {OWASP_POSTURE.map((risk) => (
                <section
                  key={risk.id}
                  className="flex flex-col rounded-2xl border border-slate-200 bg-slate-50/70 p-5"
                >
                  <h3 className="text-sm font-semibold tracking-[-0.01em] text-slate-950">
                    <span className="font-mono text-xs text-slate-500">{risk.id}</span>{" "}
                    &middot; {risk.title}
                  </h3>
                  <ul className="mt-3 space-y-2">
                    {risk.inPlace.map((line) => (
                      <li key={line} className="text-sm leading-6 text-slate-700">
                        {line}
                      </li>
                    ))}
                  </ul>
                  {risk.gap ? (
                    <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                      <span className="font-semibold">Not done:</span> {risk.gap}
                    </p>
                  ) : null}
                </section>
              ))}
            </div>

            <p className="mt-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
              {OWASP_POSTURE_LIMITS}
            </p>
          </section>

          <section className={CARD}>
            <h2 id="contact" className={HEADING}>
              Contact
            </h2>
            <p className={BODY}>
              The fastest way to reach {SITE_AUTHOR.name} is{" "}
              <a
                href={SITE_AUTHOR.url}
                rel="author noreferrer"
                target="_blank"
                className="font-medium text-slate-950 underline underline-offset-4"
              >
                GitHub
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
