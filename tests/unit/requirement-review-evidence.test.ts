import { describe, expect, it } from "vitest";

import { prepareRequirementReview, RequirementReviewProviderError } from "@/lib/ai/requirement-review";

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

  it("still refuses a quote the requirement does not contain", () => {
    try {
      prepareRequirementReview(
        review(suggestion({ evidenceQuote: "the shopper must verify their email" })),
        input,
      );
      throw new Error("it should have refused");
    } catch (error) {
      expect(error).toBeInstanceOf(RequirementReviewProviderError);
      expect((error as RequirementReviewProviderError).code).toBe("invalid_output_quote_not_found");
    }
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
    expect(() =>
      prepareRequirementReview(
        review(suggestion({ evidenceQuote: "is stored with the spaces and emailed to support." })),
        input,
      ),
    ).toThrow(RequirementReviewProviderError);
  });

  it("still refuses the whole review when a quote was invented", () => {
    // Dropping one unsupported remark is a kindness. Keeping a review that
    // attributes words to the customer is not.
    expect(() =>
      prepareRequirementReview(review(suggestion({ evidenceQuote: "the shopper must verify their email" })), input),
    ).toThrow(RequirementReviewProviderError);
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
