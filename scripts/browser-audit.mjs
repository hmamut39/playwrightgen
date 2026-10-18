/**
 * What "measured" means, in one place.
 *
 * Two harnesses walk this product's pages and neither can reach what the
 * other does: a Playwright check in CI opens the public pages signed out,
 * and `audit:phone` opens the workspace with a real Clerk session. They were
 * growing their own copies of the same measurement, which is how two rules
 * that were meant to be one drift apart. These functions are the rules; both
 * harnesses import them and run them in the page.
 *
 * Everything here is deliberately conservative. A measurement that cries
 * wolf gets switched off within a week, so anything that cannot be known --
 * text over a gradient, an element that is not rendered -- is skipped rather
 * than guessed at.
 */

/**
 * Every piece of text, against what is behind it, as WCAG AA requires:
 * 4.5:1 for ordinary text, 3:1 for large.
 *
 * Tailwind v4 writes colours as lab(), so the browser converts them rather
 * than a regular expression of ours: a 1x1 canvas fill, read back as sRGB.
 */
export const LOW_CONTRAST = () => {
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
  /** The colour behind this text, or null when it cannot be known. */
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
    const required = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    if (ratio < required) {
      found.push({
        rule: "contrast below the floor",
        ratio: Math.round(ratio * 100) / 100,
        required,
        size: Math.round(size),
        detail: `${Math.round(ratio * 100) / 100}:1 (needs ${required}:1) ${Math.round(size)}px "${text.slice(0, 40)}"`,
        cls: (typeof node.className === "string" ? node.className : "").slice(0, 70),
      });
    }
  }
  return found;
};

/**
 * What a keyboard and a screen reader need, which a sighted mouse user never
 * notices is missing: a name on every control, a label on every field, alt
 * text on every image, headings that do not skip a level, one h1, a language
 * on the document, unique ids, and a visible mark where the focus is.
 *
 * Only rendered elements are judged. A hidden file input behind a styled
 * button is announced to nobody and needs no label -- the first version of
 * this reported one, which is exactly the kind of noise that gets a check
 * ignored.
 */
export const ACCESSIBILITY = () => {
  const issues = [];
  /**
   * Whether this element is actually on the screen.
   *
   * `checkVisibility` is asked first because a box with dimensions is not the
   * same as something a person can see: the content of a closed `details` is
   * laid out but skipped, and the field inside one was reported as having no
   * focus ring when the truth was that it could not be focused at all.
   */
  const rendered = (node) => {
    if (typeof node.checkVisibility === "function") {
      if (!node.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) {
        return false;
      }
    }
    const style = getComputedStyle(node);
    if (style.visibility === "hidden" || style.display === "none") return false;
    const box = node.getBoundingClientRect();
    return box.width > 2 && box.height > 2;
  };
  // Named well enough to find: an input has no text to quote, so the report
  // carries its name, its placeholder and its classes or it sends somebody
  // hunting through a page for "an input".
  const describe = (node) => {
    const text = (node.textContent ?? "").trim().slice(0, 40);
    const attributes = ["name", "type", "placeholder"]
      .map((attribute) => (node.getAttribute(attribute) ? `${attribute}=${node.getAttribute(attribute)}` : null))
      .filter(Boolean)
      .join(" ");
    const classes = (typeof node.className === "string" ? node.className : "").slice(0, 60);
    return `${node.tagName.toLowerCase()}${node.id ? "#" + node.id : ""} ${text} ${attributes} ${classes}`.replace(/\s+/g, " ").trim();
  };

  for (const node of document.querySelectorAll("button, a[href], [role=button]")) {
    if (!rendered(node)) continue;
    const name =
      (node.getAttribute("aria-label") ?? "").trim() ||
      (node.textContent ?? "").trim() ||
      (node.querySelector("img")?.getAttribute("alt") ?? "").trim() ||
      (node.getAttribute("title") ?? "").trim();
    if (!name) issues.push({ rule: "control with no accessible name", detail: describe(node) });
  }

  for (const node of document.querySelectorAll("input, textarea, select")) {
    if ((node.getAttribute("type") ?? "").toLowerCase() === "hidden" || !rendered(node)) continue;
    const id = node.getAttribute("id");
    const labelled =
      (node.getAttribute("aria-label") ?? "").trim() ||
      (node.getAttribute("aria-labelledby") ?? "").trim() ||
      (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) ||
      node.closest("label");
    if (!labelled) {
      issues.push({
        rule: "field with no label",
        detail: `${describe(node)} name=${node.getAttribute("name") ?? "?"} placeholder=${node.getAttribute("placeholder") ?? "?"}`,
      });
    }
  }

  for (const node of document.querySelectorAll("img")) {
    if (node.getAttribute("alt") === null) {
      issues.push({ rule: "image with no alt", detail: (node.getAttribute("src") ?? "?").slice(0, 60) });
    }
  }

  const levels = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
    .filter(rendered)
    .map((heading) => Number(heading.tagName[1]));
  for (let index = 1; index < levels.length; index += 1) {
    if (levels[index] - levels[index - 1] > 1) {
      issues.push({ rule: "heading level skipped", detail: `h${levels[index - 1]} to h${levels[index]}` });
    }
  }
  if (levels.filter((level) => level === 1).length !== 1) {
    issues.push({ rule: "not exactly one h1", detail: `${levels.filter((level) => level === 1).length} found` });
  }
  if (!document.documentElement.lang) issues.push({ rule: "no lang on the document", detail: "" });

  const ids = new Map();
  for (const node of document.querySelectorAll("[id]")) ids.set(node.id, (ids.get(node.id) ?? 0) + 1);
  for (const [id, count] of ids) {
    if (count > 1) issues.push({ rule: "duplicate id", detail: `${id} x${count}` });
  }

  // Where the keyboard is must be visible. Programmatic focus is enough to
  // tell a designed ring from nothing at all: both :focus and :focus-visible
  // apply to a script-focused control in Chromium.
  const controls = [...document.querySelectorAll("a[href], button, input, textarea, select")]
    .filter(rendered)
    .slice(0, 15);
  for (const node of controls) {
    // A field with autoFocus is already focused when the page settles, so its
    // resting state would be read as its focused state and the control would
    // be reported as having no focus mark. It has one; it was wearing it.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const before = getComputedStyle(node);
    const resting = `${before.outlineStyle} ${before.outlineWidth} ${before.boxShadow} ${before.borderColor}`;
    node.focus();
    const after = getComputedStyle(node);
    const focused = `${after.outlineStyle} ${after.outlineWidth} ${after.boxShadow} ${after.borderColor}`;
    node.blur();
    if (resting === focused) {
      issues.push({ rule: "focus leaves no visible mark", detail: describe(node) });
    }
  }

  return issues;
};
