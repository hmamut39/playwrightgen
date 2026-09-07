/**
 * How a person's name is shown anywhere in the workspace.
 *
 * Names arrive from Clerk and are shown beside evidence -- who owned a
 * requirement, who approved a version, who a result is attributed to -- so they
 * carry real weight in an audit trail and should not be rendered as rubble.
 *
 * A name can reach us already broken. U+FFFD, the replacement character, is
 * what a decoder leaves behind when bytes were lost before we ever saw the
 * string, so those positions are unrecoverable and no amount of re-syncing
 * brings them back. They are dropped rather than displayed.
 *
 * Only the replacement character is removed, and never anything merely
 * unfamiliar. A name in Arabic, Uyghur, Chinese or any other script is a real
 * name; if it shows as boxes that is the reader's font missing a glyph, and the
 * data is perfectly sound. Discarding those characters would mangle the names
 * of exactly the people least well served by software written in English.
 */
const REPLACEMENT_CHARACTER = /�/g;

export const UNKNOWN_PERSON = "Workspace member";

export function personName(displayName: string | null | undefined): string {
  const cleaned = (displayName ?? "")
    .replace(REPLACEMENT_CHARACTER, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || UNKNOWN_PERSON;
}
