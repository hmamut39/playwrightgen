import { z } from "zod";

/**
 * URL validation for values that are later rendered as links.
 *
 * Zod's `.url()` only asks whether the URL constructor can parse the string, so
 * it accepts `javascript:`, `data:`, `vbscript:` and `file:` as readily as it
 * accepts `https:`. Nothing in this product has ever needed those schemes, and
 * evidence links in particular are stored immutably and clicked by reviewers
 * who are trusting the record, so the safe set is stated explicitly.
 *
 * This is defence in depth rather than a patched exploit: React already rewrites
 * a `javascript:` href before it reaches the DOM, and browsers refuse top-level
 * navigation to `data:`. The point is that a scheme which can never be a
 * legitimate artifact should not survive validation and reach storage in the
 * first place, where a future renderer would have to remember to defend itself.
 *
 * The protocol is read back from a parsed URL rather than matched against the
 * raw string, so unusual spellings cannot slip through a prefix comparison.
 */
const allowedProtocols = new Set(["http:", "https:"]);

export function webUrlSchema(maxLength = 2_000) {
  return z
    .string()
    .trim()
    .url()
    .max(maxLength)
    .refine((value) => {
      try {
        return allowedProtocols.has(new URL(value).protocol);
      } catch {
        return false;
      }
    }, "Must be an http or https URL.");
}
