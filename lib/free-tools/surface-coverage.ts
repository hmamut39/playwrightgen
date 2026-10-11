import { extractLocatorNames, normalizeName } from "@/lib/free-tools/locator-names";

/**
 * Which of a page's controls the supplied tests target by name.
 *
 * A coverage review that only says "consider testing the promo code field"
 * is an opinion. Listing every button, link and field on the real page and
 * marking which ones the pasted tests never name is a fact the reader can
 * check in seconds, and it is computed here rather than asked of the model.
 *
 * It is deliberately a mention check, not a coverage measurement: a test that
 * names a button may still assert nothing about it, and a control reached by
 * a test id will not match its accessible name. The page says so.
 *
 * Links that leave the site are kept out of the count when the page's own
 * address is known. A credit line to somebody's GitHub profile is not a
 * control of the app under test, and counting it understates coverage as
 * badly as a flattering number overstates it: a team told they reach "1 of 4
 * controls" will go looking for the three missing tests, and two of them turn
 * out to be a footer link to another website. They are reported separately
 * instead of being silently dropped.
 */

export type SurfaceControl = { role: string; name: string };

/**
 * A link's name with the address behind it. The page snapshot strips link
 * addresses out of the tree it hands the model — they are long and useless
 * for writing a locator — so they are carried alongside it for this one
 * decision, which cannot be made without them.
 */
export type LinkTarget = { name: string; url: string };

export type SurfaceOptions = {
  /** The page's own address; without it no link can be told to leave the site. */
  pageUrl?: string;
  /** Link addresses, for a tree they were stripped from. */
  linkTargets?: LinkTarget[];
};

export type SurfaceCoverage = {
  total: number;
  mentioned: SurfaceControl[];
  unmentioned: SurfaceControl[];
  /** Links pointing at another site, counted nowhere above. */
  offSite: SurfaceControl[];
};

const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "checkbox",
  "radio",
  "combobox",
  "switch",
  "tab",
  "menuitem",
  "slider",
  "spinbutton",
  "option",
]);

const MAX_CONTROLS = 60;

/** `- link "Terms"` and the like, with the indentation it sits at. */
const ENTRY = /^(\s*)- ([a-z]+) "((?:[^"\\]|\\.){1,200})"/;
/** A link's address, which Playwright nests under the link itself. */
const URL_LINE = /^(\s*)- \/url:\s*(\S{1,2000})/;

type Entry = SurfaceControl & { url?: string };

/** Interactive controls in the order the page offers them, links with their address. */
function readEntries(aria: string): Entry[] {
  const entries: Entry[] = [];
  let openLink: { entry: Entry; indent: number } | null = null;
  for (const line of aria.split("\n")) {
    const url = line.match(URL_LINE);
    // A /url line belongs to the link above it, which is less indented.
    if (url && openLink && url[1].length > openLink.indent) {
      openLink.entry.url = url[2];
      openLink = null;
      continue;
    }
    const match = line.match(ENTRY);
    if (!match) continue;
    openLink = null;
    const [, indent, role, quoted] = match;
    const name = quoted.replace(/\\"/g, '"').trim();
    if (!INTERACTIVE_ROLES.has(role) || !name) continue;
    const entry: Entry = { role, name };
    entries.push(entry);
    if (role === "link") openLink = { entry, indent: indent.length };
  }
  return entries;
}

const siteOf = (url: URL) => url.hostname.replace(/^www\./i, "").toLowerCase();

/**
 * Whether a link navigates away from the page's own site. Addresses that are
 * not web addresses at all — `mailto:`, `tel:` — leave it too. A `javascript:`
 * link or one with no address is a control of this page, not a way off it.
 */
function leavesTheSite(entry: Entry, url: string | undefined, pageUrl: string | undefined): boolean {
  if (entry.role !== "link" || !url || !pageUrl) return false;
  if (/^(mailto|tel|sms):/i.test(url)) return true;
  try {
    const target = new URL(url, pageUrl);
    if (target.protocol !== "http:" && target.protocol !== "https:") return false;
    return siteOf(target) !== siteOf(new URL(pageUrl));
  } catch {
    return false;
  }
}

/** Link names with their addresses, read from a tree that still has them. */
export function readLinkTargets(aria: string): LinkTarget[] {
  const targets: LinkTarget[] = [];
  for (const entry of readEntries(aria)) {
    if (entry.role === "link" && entry.url) targets.push({ name: entry.name, url: entry.url });
  }
  return targets;
}

/**
 * Controls with an accessible name, from a Playwright aria snapshot, split
 * into the page's own and the links that lead off it.
 *
 * Without the page's address nothing can be told to leave the site, so every
 * control is the page's own — the same reading this returned before a page
 * address was passed in. The addresses may come with the tree or beside it.
 */
export function readSurface(
  aria: string,
  options: SurfaceOptions = {},
): { controls: SurfaceControl[]; offSite: SurfaceControl[] } {
  const addresses = new Map((options.linkTargets ?? []).map((link) => [normalizeName(link.name), link.url]));
  const controls: SurfaceControl[] = [];
  const offSite: SurfaceControl[] = [];
  const seen = new Set<string>();
  for (const entry of readEntries(aria)) {
    const key = `${entry.role}:${entry.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const control = { role: entry.role, name: entry.name };
    const url = entry.url ?? addresses.get(normalizeName(entry.name));
    (leavesTheSite(entry, url, options.pageUrl) ? offSite : controls).push(control);
    if (controls.length >= MAX_CONTROLS) break;
  }
  return { controls, offSite };
}

/** Interactive controls with an accessible name, from a Playwright aria snapshot. */
export function readControls(aria: string, options: SurfaceOptions = {}): SurfaceControl[] {
  return readSurface(aria, options).controls;
}

export function measureSurfaceCoverage(aria: string, tests: string, options: SurfaceOptions = {}): SurfaceCoverage {
  const { controls, offSite } = readSurface(aria, options);
  // Names the tests target through role, label, text or placeholder locators.
  const targeted = new Set(extractLocatorNames(tests).map(normalizeName));
  const mentioned: SurfaceControl[] = [];
  const unmentioned: SurfaceControl[] = [];
  for (const control of controls) {
    (targeted.has(normalizeName(control.name)) ? mentioned : unmentioned).push(control);
  }
  return { total: controls.length, mentioned, unmentioned, offSite };
}
