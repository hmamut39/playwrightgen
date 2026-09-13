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
 */

export type SurfaceControl = { role: string; name: string };

export type SurfaceCoverage = {
  total: number;
  mentioned: SurfaceControl[];
  unmentioned: SurfaceControl[];
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

/** Interactive controls with an accessible name, from a Playwright aria snapshot. */
export function readControls(aria: string): SurfaceControl[] {
  const controls: SurfaceControl[] = [];
  const seen = new Set<string>();
  for (const match of aria.matchAll(/^\s*- ([a-z]+) "((?:[^"\\]|\\.){1,200})"/gm)) {
    const role = match[1];
    const name = match[2].replace(/\\"/g, '"').trim();
    if (!INTERACTIVE_ROLES.has(role) || !name) continue;
    const key = `${role}:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    controls.push({ role, name });
    if (controls.length >= MAX_CONTROLS) break;
  }
  return controls;
}

export function measureSurfaceCoverage(aria: string, tests: string): SurfaceCoverage {
  const controls = readControls(aria);
  // Names the tests target through role, label, text or placeholder locators.
  const targeted = new Set(extractLocatorNames(tests).map(normalizeName));
  const mentioned: SurfaceControl[] = [];
  const unmentioned: SurfaceControl[] = [];
  for (const control of controls) {
    (targeted.has(normalizeName(control.name)) ? mentioned : unmentioned).push(control);
  }
  return { total: controls.length, mentioned, unmentioned };
}
