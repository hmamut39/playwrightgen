import type { Metadata } from "next";
import Link from "next/link";

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

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-4xl font-semibold tracking-[-0.02em] text-slate-950">
        About {SITE_NAME}
      </h1>

      <p className="mt-6 text-lg leading-8 text-slate-700">
        {SITE_NAME} is built by{" "}
        <a
          href={SITE_AUTHOR.url}
          rel="author noreferrer"
          target="_blank"
          className="font-semibold text-slate-950 underline underline-offset-4"
        >
          {SITE_AUTHOR.name}
        </a>
        , who also goes by {SITE_AUTHOR.alternateName}. It is an independent
        product, designed and written by one person rather than a company.
      </p>

      <h2 className="mt-12 text-2xl font-semibold tracking-[-0.02em] text-slate-950">
        What it is for
      </h2>
      <p className="mt-4 text-base leading-7 text-slate-700">{SITE_PURPOSE}</p>
      <p className="mt-4 text-base leading-7 text-slate-700">
        Writing an end-to-end test is the part everybody automates. The part
        that decides whether a release is safe is quieter: which requirement a
        test belongs to, who approved it, which version of it last ran, whether
        that run was yesterday or in March, and whether anybody outside the team
        ever accepted the result. {SITE_NAME} keeps that chain, and refuses to
        round it up.
      </p>

      <h2 className="mt-12 text-2xl font-semibold tracking-[-0.02em] text-slate-950">
        What it will not do
      </h2>
      <p className="mt-4 text-base leading-7 text-slate-700">
        It does not call a test proven when the run was partly skipped. It does
        not call a project releasable, because that is a judgement a person
        makes. It will not repair a failing test whose failure looks like a real
        defect in the product, because quietly fixing the test would delete the
        only warning anybody was going to get. Where it has counted only part of
        a project, it says so, on every page and in every file it produces.
      </p>
      <p className="mt-4 text-base leading-7 text-slate-700">
        Your tests run on your own machines, in your own CI, against your own
        environment. {SITE_NAME} never executes your code and never receives
        your repository contents &mdash; only a bounded summary of results.
      </p>

      {/*
        * What is done about each risk on the current OWASP list, and what is
        * not.
        *
        * On this page rather than a new one, because a security page nobody
        * links to is a security page nobody reads, and because every claim
        * here is of the same kind as the two sections above it: something
        * this product does or refuses to do. The claims that can be checked
        * are checked by tests/unit/owasp-posture.test.ts against the code
        * that makes them true, so a sentence here cannot outlive its
        * implementation -- which is how three files came to state one sending
        * address and one setting moved only one of them.
        */}
      <h2 className="mt-12 text-2xl font-semibold tracking-[-0.02em] text-slate-950">
        How it is secured
      </h2>
      <p className="mt-4 text-base leading-7 text-slate-700">
        Mapped against the{" "}
        <a
          href={OWASP_SOURCE}
          rel="noreferrer"
          target="_blank"
          className="font-medium text-slate-950 underline underline-offset-4"
        >
          {OWASP_EDITION}
        </a>
        , read on {readable(OWASP_CHECKED_ON)}. Where there is nothing in place, it says
        so in the same voice as the rest.
      </p>

      <div className="mt-8 space-y-8">
        {OWASP_POSTURE.map((risk) => (
          <section key={risk.id}>
            <h3 className="text-sm font-semibold tracking-[-0.01em] text-slate-950">
              <span className="font-mono text-xs text-slate-500">{risk.id}</span> &middot;{" "}
              {risk.title}
            </h3>
            <ul className="mt-2 space-y-2">
              {risk.inPlace.map((line) => (
                <li key={line} className="text-sm leading-6 text-slate-700">
                  {line}
                </li>
              ))}
            </ul>
            {risk.gap ? (
              <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                <span className="font-semibold">Not done:</span> {risk.gap}
              </p>
            ) : null}
          </section>
        ))}
      </div>

      <p className="mt-8 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
        {OWASP_POSTURE_LIMITS}
      </p>

      <h2 className="mt-12 text-2xl font-semibold tracking-[-0.02em] text-slate-950">
        Contact
      </h2>
      <p className="mt-4 text-base leading-7 text-slate-700">
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

      <div className="mt-12 flex flex-wrap gap-4 text-sm">
        <Link
          href="/"
          className="rounded-xl bg-slate-950 px-4 py-2.5 font-semibold text-white hover:bg-slate-800"
        >
          See what it does
        </Link>
        <Link
          href="/generator"
          className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 font-semibold text-slate-800 hover:bg-slate-50"
        >
          Try it without an account
        </Link>
      </div>
    </main>
  );
}
