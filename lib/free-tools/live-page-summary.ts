/**
 * What was found on the page somebody gave us, in one readable line.
 *
 * Two different measures were being printed as one. `controls` counts what a
 * test can target by name *on this app*, with links that lead elsewhere
 * excluded. `counts` is every element the tree held, those links included.
 * The coverage page joined them with a colon:
 *
 *     1 named control: 0 buttons, 1 fields, 3 links · seen signed out
 *     3 links to another site left out of the count
 *
 * A colon promises that what follows explains the number before it, and this
 * explained 1 with four things. The next line then said three of those links
 * were "left out of the count" -- the count they had just appeared in. Both
 * sentences were true of different measures and neither said which.
 *
 * "1 fields" and "1 headings" were in there too, on the free generator as
 * well, which is the sort of thing a visitor reads as carelessness about
 * everything else.
 *
 * Found on 2026-11-22 while walking Coverage Review as a stranger -- the
 * first time anybody had used that tool at all.
 */
export type LivePageCounts = {
  buttons: number;
  fields: number;
  links: number;
  headings?: number;
};

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** "0 buttons, 1 field and 3 links", with the Oxford-free list a person writes. */
function listOf(counts: LivePageCounts): string {
  const parts = [plural(counts.buttons, "button"), plural(counts.fields, "field"), plural(counts.links, "link")];
  if (typeof counts.headings === "number") parts.push(plural(counts.headings, "heading"));
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export function livePageSummary(input: {
  counts: LivePageCounts;
  signedIn?: boolean;
  /** Named controls on this app: what a test can target, off-site links excluded. */
  controls?: number;
  /** Links that lead away from the app, which are not part of what it covers. */
  offSite?: number;
}): string {
  const seen = input.signedIn ? "seen signed in with your test account" : "seen signed out";
  const sentences = [`${listOf(input.counts)}, ${seen}.`];

  if (typeof input.controls === "number") {
    // Said as its own sentence, because it is its own measure. "Of these" and
    // not a colon: the number does not explain the list, it narrows it.
    sentences.push(
      input.controls === 1
        ? "One of these is a control a test can reach by name."
        : `${input.controls} of these are controls a test can reach by name.`,
    );
  }

  if (input.offSite && input.offSite > 0) {
    sentences.push(
      `${plural(input.offSite, "link")} lead${input.offSite === 1 ? "s" : ""} to another site, so ${
        input.offSite === 1 ? "it is" : "they are"
      } not counted among them.`,
    );
  }

  return sentences.join(" ");
}
