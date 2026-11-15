import { describe, expect, it } from "vitest";

import { prepareRequirementReview } from "@/lib/ai/requirement-review";

/**
 * The rule: a suggestion must quote the requirement, so nothing can be
 * attributed to text the customer never wrote. Found on 2026-10-12 to be
 * refusing honest quotes as well: the requirement had been drafted from a
 * pasted ticket and carried curly apostrophes, the model typed them back
 * straight, and the whole review was discarded with one unexplained code.
 */
const input = {
  title: "A shopper’s todo items persist across reloads",
  description:
    "QA found that a todo typed with spaces around it (“  milk  ”) is stored with the spaces — which looks like a different item.",
  acceptanceCriteria: "After a reload, the same todo items are present.",
  externalReference: "ACME-418",
};

const suggestion = (over: Partial<Parameters<typeof prepareRequirementReview>[0]["suggestions"][number]>) => ({
  category: "AMBIGUITY" as const,
  severity: "MEDIUM" as const,
  title: "Say what counts as a reload",
  observation: "A soft navigation is not a reload.",
  recommendation: "State that a full page reload is meant.",
  evidenceField: "TITLE" as const,
  evidenceQuote: "a shopper’s todo items",
  ...over,
});

const review = (...suggestions: ReturnType<typeof suggestion>[]) => ({
  summary: "Mostly clear.",
  suggestions,
});

describe("quoting the requirement", () => {
  it("accepts a quote retyped with straight quotes, dashes and ellipses", () => {
    expect(() =>
      prepareRequirementReview(
        review(
          suggestion({ evidenceQuote: "a shopper's todo items" }),
          suggestion({
            evidenceField: "DESCRIPTION",
            evidenceQuote: 'typed with spaces around it ("  milk  ") is stored with the spaces - which looks',
          }),
        ),
        input,
      ),
    ).not.toThrow();
  });

  it("drops a quote the requirement does not contain, and keeps the rest of the review", () => {
    /*
     * This used to throw, and the throw reached people as an error page.
     *
     * The rule is unchanged: a suggestion quoting words the customer never
     * wrote does not reach the reviewer. What changed is the blast radius.
     * Refusing the whole review turned one invented quote into a 502 and the
     * sentence "the AI review did not finish", with nothing in it to act on
     * -- while a suggestion with no quote at all, which is weaker evidence,
     * was already being dropped politely and counted in the summary.
     *
     * The eval named it on 2026-11-14: "reviewing a requirement does not
     * invent problems in a requirement that has none" failed with
     * invalid_output_quote_not_found. A model pressed to find fault in a
     * clean requirement invents one, and the customer got an error instead of
     * a review that said nothing was wrong.
     */
    const prepared = prepareRequirementReview(
      review(
        suggestion({ evidenceQuote: "a shopper's todo items" }),
        suggestion({ evidenceQuote: "the shopper must verify their email" }),
      ),
      input,
    );

    expect(prepared.droppedFabricated).toBe(1);
    // The fabrication is gone; the suggestion that quoted correctly survives.
    expect(prepared.review.suggestions).toHaveLength(1);
    expect(prepared.review.suggestions[0]?.evidenceQuote).toContain("todo items");
    expect(prepared.review.summary).toContain("quoted words that are not in this requirement");
    expect(prepared.review.summary).toContain("did not write");
  });


  it("still tells the two kinds of bad evidence apart in the summary", () => {
    const prepared = prepareRequirementReview(
      review(
        suggestion({ category: "EDGE_CASE", evidenceQuote: "" }),
        suggestion({ evidenceQuote: "the shopper must verify their email" }),
      ),
      input,
    );

    expect(prepared.droppedWithoutQuote).toBe(1);
    expect(prepared.droppedFabricated).toBe(1);
    expect(prepared.review.summary).toContain("quoted nothing in this requirement");
    expect(prepared.review.summary).toContain("quoted words that are not in this requirement");
  });

  it("keeps the suggestions that quote, and says what it dropped", () => {
    // What actually happened on 2026-10-12: the model raised an edge case
    // without quoting anything, and the whole review was thrown away.
    const prepared = prepareRequirementReview(
      review(
        suggestion({ evidenceQuote: "a shopper's todo items" }),
        suggestion({ category: "EDGE_CASE", evidenceQuote: "" }),
        suggestion({ category: "UNANSWERED_QUESTION", evidenceQuote: "" }),
      ),
      input,
    );

    expect(prepared.droppedWithoutQuote).toBe(1);
    expect(prepared.review.suggestions).toHaveLength(2);
    expect(prepared.review.summary).toContain("1 further suggestion quoted nothing");
    expect(prepared.review.summary).toContain("not evidence");
  });

  it("keeps a real quote that was filed under the wrong field, and corrects the label", () => {
    // Measured on 2026-10-15: the model quoted an acceptance criterion word
    // for word and labelled it DESCRIPTION, and the product discarded the
    // whole review of a well-written requirement. The rule is that nothing is
    // attributed to a customer who did not write it; a quote that is in the
    // requirement does not break that rule, whichever heading was named.
    const prepared = prepareRequirementReview(
      review(suggestion({ evidenceField: "DESCRIPTION", evidenceQuote: "After a reload, the same todo items are present." })),
      input,
    );

    expect(prepared.relabelled).toBe(1);
    expect(prepared.review.suggestions).toHaveLength(1);
    expect(prepared.review.suggestions[0].evidenceField).toBe("ACCEPTANCE_CRITERIA");
    // The reviewer is shown where the text really is, so nothing is left for
    // them to reconcile and the summary says nothing about it.
    expect(prepared.review.summary).toBe("Mostly clear.");
  });

  it("counts nothing relabelled when every field was named correctly", () => {
    const prepared = prepareRequirementReview(review(suggestion({ evidenceQuote: "a shopper's todo items" })), input);
    expect(prepared.relabelled).toBe(0);
  });

  it("accepts a quotation that stops mid-sentence and closes with a full stop", () => {
    // Measured on 2026-10-15. The requirement says the todo "(“  milk  ”) is
    // stored with the spaces — which looks like a different item"; quoting as
    // far as "stored with the spaces." is how people quote, and the whole
    // review was being discarded for the added full stop.
    const prepared = prepareRequirementReview(
      review(
        suggestion({
          evidenceField: "DESCRIPTION",
          evidenceQuote: "is stored with the spaces.",
        }),
      ),
      input,
    );

    expect(prepared.review.suggestions).toHaveLength(1);
    expect(prepared.droppedWithoutQuote).toBe(0);
  });

  it("does not let trimming admit a word the requirement never contained", () => {
    // Trailing punctuation is trimmed so that ending a quotation early still
    // counts. "emailed to support" is not in the requirement at all, and no
    // amount of trimming may let it through.
    const prepared = prepareRequirementReview(
      review(suggestion({ evidenceQuote: "is stored with the spaces and emailed to support." })),
      input,
    );

    expect(prepared.review.suggestions).toHaveLength(0);
    expect(prepared.droppedFabricated).toBe(1);
    expect(JSON.stringify(prepared.review)).not.toContain("emailed to support");
  });

  it("never passes on an invented quote, and no longer takes the review down with it", () => {
    /*
     * The guarantee and the blast radius are different things.
     *
     * The guarantee is absolute and tested here by looking at everything that
     * comes back: words the customer did not write appear nowhere in it. What
     * changed on 2026-11-15 is what happens to the rest. Throwing turned one
     * invented quote into a 502 and a page reading "the AI review did not
     * finish", which told the reviewer nothing and left them with no review
     * at all.
     */
    const prepared = prepareRequirementReview(
      review(suggestion({ evidenceQuote: "the shopper must verify their email" })),
      input,
    );

    expect(JSON.stringify(prepared.review)).not.toContain("verify their email");
    expect(prepared.review.suggestions).toHaveLength(0);
    expect(prepared.droppedFabricated).toBe(1);
    // And the reviewer is told, rather than left to wonder.
    expect(prepared.review.summary).toContain("1 suggestion quoted words that are not in this requirement");
  });

  it("says nothing extra when every suggestion quoted something", () => {
    const prepared = prepareRequirementReview(review(suggestion({ evidenceQuote: "a shopper's todo items" })), input);
    expect(prepared.droppedWithoutQuote).toBe(0);
    expect(prepared.review.summary).toBe("Mostly clear.");
  });

  it("keeps an empty quote only where there is nothing to quote", () => {
    // A missing criterion has nothing to cite by definition; an ambiguity
    // claim that cites nothing is a remark nobody can check, so it goes --
    // and the rest of the review stays, which is the whole difference
    // between this and what shipped before 2026-10-12.
    const allowed = prepareRequirementReview(
      review(suggestion({ category: "MISSING_ACCEPTANCE_CRITERIA", evidenceQuote: "" })),
      input,
    );
    expect(allowed.review.suggestions).toHaveLength(1);
    expect(allowed.droppedWithoutQuote).toBe(0);

    const unsupported = prepareRequirementReview(
      review(suggestion({ category: "AMBIGUITY", evidenceQuote: "" })),
      input,
    );
    expect(unsupported.review.suggestions).toHaveLength(0);
    expect(unsupported.droppedWithoutQuote).toBe(1);
  });
});
