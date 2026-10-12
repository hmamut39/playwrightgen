import { describe, expect, it } from "vitest";

import {
  prepareRequirementReview,
  RequirementReviewProviderError,
  validateRequirementReviewEvidence,
} from "@/lib/ai/requirement-review";

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

const suggestion = (over: Partial<Parameters<typeof validateRequirementReviewEvidence>[0]["suggestions"][number]>) => ({
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
      validateRequirementReviewEvidence(
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
      validateRequirementReviewEvidence(
        review(suggestion({ evidenceQuote: "the shopper must verify their email" })),
        input,
      );
      throw new Error("it should have refused");
    } catch (error) {
      expect(error).toBeInstanceOf(RequirementReviewProviderError);
      expect((error as RequirementReviewProviderError).code).toBe("invalid_output_quote_not_found");
    }
  });

  it("refuses a quote taken from a different field than the one named", () => {
    // The words exist in the requirement, but not where the suggestion says.
    try {
      validateRequirementReviewEvidence(
        review(suggestion({ evidenceField: "ACCEPTANCE_CRITERIA", evidenceQuote: "a shopper's todo items" })),
        input,
      );
      throw new Error("it should have refused");
    } catch (error) {
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

  it("allows an empty quote only where there is nothing to quote", () => {
    expect(() =>
      validateRequirementReviewEvidence(
        review(suggestion({ category: "MISSING_ACCEPTANCE_CRITERIA", evidenceQuote: "" })),
        input,
      ),
    ).not.toThrow();

    try {
      validateRequirementReviewEvidence(review(suggestion({ category: "AMBIGUITY", evidenceQuote: "" })), input);
      throw new Error("it should have refused");
    } catch (error) {
      expect((error as RequirementReviewProviderError).code).toBe("invalid_output_quote_missing");
    }
  });
});
