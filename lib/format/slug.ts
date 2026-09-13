/**
 * Turns a human name into a slug that satisfies the project slug rule:
 * lowercase letters and digits, separated by single hyphens.
 *
 * The create-project form asked people to invent this themselves, and they
 * stopped to ask what to type -- one of them first typed an underscore, which
 * the field then rejected without saying why. A slug is plumbing; the name is
 * what the person actually has in mind, so the slug is derived from it and the
 * field becomes an override rather than a question.
 *
 * Accents are folded ("Café" becomes "cafe"). A name written entirely in a
 * script with no Latin letters produces nothing to keep, so it falls back to a
 * generic slug rather than an empty one, which would fail the rule.
 */
const MAX_LENGTH = 100;

/** Combining marks left behind once accented letters are decomposed. */
const COMBINING_MARKS = /[\u0300-\u036f]/g;

export function slugify(name: string, fallback = "project"): string {
  const slug = name
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_LENGTH)
    .replace(/-+$/g, "");

  return slug || fallback;
}
