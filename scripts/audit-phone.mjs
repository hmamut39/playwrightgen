/**
 * Every workspace page, measured: narrow enough, and readable.
 *
 * A page wider than the screen slides sideways under the thumb, and nothing in
 * the test suite notices: the review pages carried that fault for weeks because
 * a long URL in a heading and a CSS grid with no column rule only misbehave
 * below 400px. This walks the signed-in workspace at 390px and fails when a
 * page is wider than the viewport, naming the box whose content overflows.
 *
 *   npm run audit:phone                      # against http://localhost:3000
 *   AUDIT_BASE_URL=https://staging… npm run audit:phone
 *
 * It signs in with a Clerk sign-in ticket, so it needs a development Clerk
 * secret (CLERK_SECRET_KEY, from .env.local) and the email of a member who can
 * see a project (AUDIT_EMAIL, or the first person the workspace lists).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "playwright";

const BASE = (process.env.AUDIT_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const WIDTH = Number(process.env.AUDIT_WIDTH ?? 390);
const HEIGHT = Number(process.env.AUDIT_HEIGHT ?? 844);

function loadEnvironment() {
  const values = { ...process.env };
  try {
    for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
      if (match && !values[match[1]]) values[match[1]] = match[2].replace(/^"|"$/g, "");
    }
  } catch {
    // No .env.local: the environment must already carry the secret.
  }
  return values;
}

async function clerk(environment, method, path, body) {
  const response = await fetch(`https://api.clerk.com/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${environment.CLERK_SECRET_KEY}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`Clerk ${method} ${path} failed: ${response.status}`);
  return response.json();
}

/** The widest box whose own content does not fit, which is what pushes the page. */
const OVERFLOWING = () => {
  const culprits = [];
  for (const element of document.querySelectorAll("body, body *")) {
    if (getComputedStyle(element).overflowX !== "visible" || element.clientWidth === 0) continue;
    if (element.scrollWidth <= element.clientWidth + 1) continue;
    const child = [...element.children].find(
      (candidate) => candidate.scrollWidth > candidate.clientWidth + 1 && getComputedStyle(candidate).overflowX === "visible",
    );
    if (!child) {
      const name = `${element.tagName.toLowerCase()}.${String(element.className).split(" ").slice(0, 3).join(".")}`;
      culprits.push(`${name} (${element.clientWidth}px shows ${element.scrollWidth}px) "${(element.textContent ?? "").trim().slice(0, 40)}"`);
    }
  }
  return { pageWidth: document.documentElement.scrollWidth, viewport: window.innerWidth, culprits: culprits.slice(0, 3) };
};

/**
 * Every piece of text on the page, against what is behind it.
 *
 * The public pages got this on 2026-10-18 and the workspace could not: it is
 * behind a sign-in, and the browser check that guards the marketing site
 * cannot reach it. This walk already has a session, so it measures here too.
 *
 * Tailwind v4 writes colours as lab(), so the browser converts them rather
 * than a regular expression: a 1x1 canvas fill, read back as sRGB. Text over
 * a gradient or an image has no background colour to read and is skipped
 * rather than guessed at.
 */
const LOW_CONTRAST = () => {
  const surface = document.createElement("canvas");
  surface.width = 1;
  surface.height = 1;
  const context = surface.getContext("2d", { willReadFrequently: true });
  const toRgb = (value) => {
    if (!context || !value || value === "transparent") return null;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = "#000";
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a: alpha / 255 };
  };
  const luminance = ({ r, g, b }) => {
    const channel = (value) => {
      const scaled = value / 255;
      return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const backgroundOf = (node) => {
    let element = node;
    while (element) {
      const style = getComputedStyle(element);
      if (style.backgroundImage && style.backgroundImage !== "none") return null;
      const colour = toRgb(style.backgroundColor);
      if (colour && colour.a > 0.5) return colour;
      element = element.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };

  const found = [];
  for (const node of document.querySelectorAll("p, span, li, a, h1, h2, h3, h4, td, th, label, div, button")) {
    if (node.children.length > 0) continue;
    const text = (node.textContent ?? "").trim();
    if (text.length < 4) continue;
    const style = getComputedStyle(node);
    if (style.visibility === "hidden" || style.display === "none") continue;
    const box = node.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    const foreground = toRgb(style.color);
    if (!foreground || foreground.a < 0.5) continue;
    const background = backgroundOf(node);
    if (!background) continue;
    const first = luminance(foreground);
    const second = luminance(background);
    const ratio = (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    const size = parseFloat(style.fontSize);
    const bold = Number.parseInt(style.fontWeight, 10) >= 700;
    // WCAG AA: 3:1 for large text, 4.5:1 for everything else.
    const required = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    if (ratio < required) {
      found.push({
        ratio: Math.round(ratio * 100) / 100,
        required,
        size: Math.round(size),
        text: text.slice(0, 44),
        cls: (typeof node.className === "string" ? node.className : "").slice(0, 70),
      });
    }
  }
  return found;
};

const PROJECT_TABS = [
  "overview",
  "health",
  "requirements",
  "test-cases",
  "cover",
  "automation",
  "test-runs",
  "release",
  "release/report",
  "reviews",
  "quality",
  "repositories",
  "activity",
  "team",
];

async function main() {
  const environment = loadEnvironment();
  if (!environment.CLERK_SECRET_KEY) throw new Error("CLERK_SECRET_KEY is required (put it in .env.local).");
  if (BASE.includes("localhost") && !environment.CLERK_SECRET_KEY.startsWith("sk_test_")) {
    throw new Error("Refusing to sign in to a local server with a production Clerk key.");
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
  // jsdelivr intermittently 404s the unpinned "@clerk/ui@1"; the pinned build works.
  await context.route(/cdn\.jsdelivr\.net\/npm\/@clerk\/ui@1\//, (route) =>
    route.continue({ url: route.request().url().replace("@clerk/ui@1/", "@clerk/ui@1.33.0/") }),
  );
  const page = await context.newPage();
  const failures = [];
  const checked = [];
  /** One entry per style that fails, with the pages it was seen on. */
  const contrast = new Map();

  try {
    const email =
      process.env.AUDIT_EMAIL ??
      (await clerk(environment, "GET", "/users?limit=1"))[0]?.email_addresses?.[0]?.email_address;
    if (!email) throw new Error("No user to sign in as; set AUDIT_EMAIL.");
    const [user] = await clerk(environment, "GET", `/users?email_address=${encodeURIComponent(email)}`);
    const ticket = await clerk(environment, "POST", "/sign_in_tokens", { user_id: user.id, expires_in_seconds: 600 });
    await page.goto(`${BASE}/sign-in?__clerk_ticket=${ticket.token}`, { waitUntil: "domcontentloaded" });
    // The ticket is consumed by Clerk in the browser; wait for the session.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await page.waitForTimeout(2_500);
      await page.goto(`${BASE}/workspace`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1_500);
      if (!/sign-in/.test(page.url())) break;
    }
    if (/sign-in/.test(page.url())) throw new Error(`Could not sign in as ${email}; is the Clerk key for this server?`);
    // A real project, not "/projects/new": that link is also a /projects/
    // link, and following it made every tab 500 on an id that was never a
    // project, which read as the product being broken when it was not.
    const hrefs = await page
      .locator("a[href*='/projects/']")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    const uuid = /\/projects\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/|$)/i;
    const projectHref = hrefs.find((href) => uuid.test(href)) ?? null;
    if (!projectHref) throw new Error(`No project visible to ${email}; the audit needs one.`);
    const projectBase = new URL(projectHref, page.url())
      .toString()
      .replace(/(\/projects\/[0-9a-f-]{36})\/.*$/i, "$1");
    const organizationBase = projectBase.replace(/\/projects\/.*$/, "");

    const pages = [
      ["workspace home", organizationBase],
      ["billing", `${organizationBase}/billing`],
      ["new project", `${organizationBase}/projects/new`],
      ...PROJECT_TABS.map((tab) => [tab, `${projectBase}/${tab}`]),
    ];

    /**
     * The first item on a list page, which is where people actually read.
     *
     * Walking the tabs alone measures thirteen index pages and none of the
     * detail pages a reviewer spends their day on. Each list links its items
     * by id, so the first one is followed when there is one; a project with
     * an empty list simply contributes nothing.
     */
    async function firstDetail(tab) {
      await page.goto(`${projectBase}/${tab}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(800);
      const href = await page
        .locator(`a[href*='/${tab}/']`)
        .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? "")[0] ?? "");
      const id = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/|$)/i;
      return href && id.test(href) ? [`${tab} detail`, new URL(href, page.url()).toString()] : null;
    }

    for (const tab of ["requirements", "test-cases", "automation", "test-runs", "cover"]) {
      const detail = await firstDetail(tab);
      if (detail) pages.push(detail);
    }

    for (const [name, url] of pages) {
      const response = await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1_200);
      const report = await page.evaluate(OVERFLOWING);
      const dim = await page.evaluate(LOW_CONTRAST);
      const wide = report.pageWidth > report.viewport;
      checked.push(name);
      for (const entry of dim) {
        const key = `${entry.cls}|${entry.ratio}`;
        if (!contrast.has(key)) contrast.set(key, { ...entry, pages: new Set() });
        contrast.get(key).pages.add(name);
      }
      const status = response?.status() ?? 0;
      if (status >= 400) {
        failures.push(`${name}: HTTP ${status}`);
        console.log(`FAIL ${name.padEnd(16)} HTTP ${status}`);
        continue;
      }
      console.log(
        `${wide ? "WIDE" : "ok  "} ${name.padEnd(16)} ${report.pageWidth}px${wide ? `  <- ${report.culprits.join(" | ")}` : ""}`,
      );
      if (wide) failures.push(`${name}: ${report.pageWidth}px wide at ${WIDTH}px — ${report.culprits.join(" | ")}`);
    }
  } finally {
    await context.close();
    await browser.close();
  }

  console.log(`\n${checked.length} pages measured at ${WIDTH}px; ${failures.length} wider than the screen.`);
  if (failures.length) {
    for (const failure of failures) console.log(`  - ${failure}`);
  }

  const dim = [...contrast.values()].sort((a, b) => a.ratio - b.ratio);
  console.log(`${dim.length} styles below the WCAG AA contrast floor.`);
  for (const entry of dim) {
    console.log(`  - ${entry.ratio}:1 (needs ${entry.required}:1) ${entry.size}px on ${[...entry.pages].join(", ")}`);
    console.log(`      "${entry.text}"`);
    console.log(`      ${entry.cls}`);
  }

  if (failures.length || dim.length) process.exitCode = 1;
}

await main();
