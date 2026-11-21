/**
 * Personal data on a customer's page, masked before a model reads it.
 *
 * The product reads a real page and sends its accessibility tree to a model
 * to build locators from. On a marketing page that tree is headings and
 * buttons. On the page a team actually wants covered -- an admin list, an
 * order history, a CRM screen -- it is people's addresses and card numbers,
 * and all of it left for a third party with nothing on screen saying so.
 *
 * `redactSupplied` already blanks a test account's credentials out of what a
 * run reports back. That is the same question asked on the way out, and it
 * had no answer on the way in.
 *
 * What this does not do is pretend to be complete. It catches the shapes that
 * are unambiguous in an accessibility tree -- an address with an @ between
 * two labels, a run of digits long enough to be a card, a phone number -- and
 * reports what it found so the page can say it out loud. A name in a table
 * cell is indistinguishable from a product name and is not masked; claiming
 * otherwise would be the more dangerous lie, so the note says so too.
 *
 * It must also not break the thing the product is for. A tree is full of
 * labels like "Email" and "Phone number", and those carry no digits and no @,
 * so they are untouched by construction -- a locator built from
 * getByRole('textbox', { name: 'Email' }) still works. What changes is the
 * value sitting beside the label, which no locator should depend on.
 */

/** An address, kept recognisable as one so the model still knows the field. */
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/**
 * Thirteen or more digits, optionally spaced or hyphenated: a card number, an
 * IBAN, an account. Short runs are left alone because a tree is full of
 * prices, counts, years and ids, and masking those would take the page's
 * meaning with them.
 */
const LONG_NUMBER = /\b(?:\d[ -]?){13,}\d\b/g;

/**
 * A phone number in the shapes people write them.
 *
 * Two forms, deliberately. With a country code or a bracketed area code, two
 * groups are enough -- "+44 20 7946 0958", "(020) 7946-0958". Without one,
 * three separated groups are required, so "1 item left", "16.4.6" and
 * "$1,299.00" cannot pass for a number somebody could be rung on.
 */
const PHONE = new RegExp(
  [
    String.raw`(?:\+\d{1,3}[ -]?|\(\d{2,4}\)[ -]?)\d{2,4}[ -]?\d{2,4}(?:[ -]?\d{2,4})?`,
    String.raw`\b\d{2,4}[ -]\d{2,4}[ -]\d{2,4}(?:[ -]\d{2,4})?\b`,
  ].join("|"),
  "g",
);

export type PersonalDataFound = {
  emails: number;
  longNumbers: number;
  phones: number;
  total: number;
};

export type Redaction = { text: string; found: PersonalDataFound };

const MASK = "•••";

/**
 * Masks what is clearly personal and counts what it masked.
 *
 * Order matters: addresses are taken first, because the digits inside one
 * would otherwise be read as a phone number and the @ left dangling.
 */
export function redactPersonalData(text: string): Redaction {
  let emails = 0;
  let longNumbers = 0;
  let phones = 0;

  // Kept as an address shape, so a model still knows an email field is an
  // email field and writes a locator for one.
  let redacted = text.replace(EMAIL, () => {
    emails += 1;
    return `${MASK}@${MASK}`;
  });

  redacted = redacted.replace(LONG_NUMBER, () => {
    longNumbers += 1;
    return MASK;
  });

  redacted = redacted.replace(PHONE, (match) => {
    // A date is not a phone number, and every list screen has one.
    if (/^\d{4}-\d{2}-\d{2}$/.test(match.trim())) return match;
    phones += 1;
    return MASK;
  });

  return {
    text: redacted,
    found: { emails, longNumbers, phones, total: emails + longNumbers + phones },
  };
}

/**
 * What to tell the reader, or null when there is nothing to tell them.
 *
 * Said in the product's own habit: name the thing, give the number, and do
 * not imply the list is exhaustive when it is not.
 */
export function redactionNote(found: PersonalDataFound): string | null {
  if (found.total === 0) return null;
  const parts: string[] = [];
  if (found.emails > 0) parts.push(`${found.emails} email address${found.emails === 1 ? "" : "es"}`);
  if (found.phones > 0) parts.push(`${found.phones} phone number${found.phones === 1 ? "" : "s"}`);
  if (found.longNumbers > 0) {
    parts.push(`${found.longNumbers} long number${found.longNumbers === 1 ? "" : "s"}`);
  }
  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  const was = found.total === 1 ? "was" : "were";
  const it = found.total === 1 ? "it was" : "they were";
  return `${list} on this page ${was} masked before the page was read, so ${it} never sent to the model. Names and free text cannot be detected this way and were not masked.`;
}
