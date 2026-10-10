import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { CI_TEMPLATES, type CiTemplateName } from "@/lib/ci/templates";

/**
 * Reading a pipeline file off disk.
 *
 * The setup panel used to tell people to copy two files out of
 * `templates/github-actions/`, which exists in PlaywrightGen's repository and
 * nowhere a customer can reach. The instruction was impossible to follow for
 * everybody except the person who wrote it -- and it sat in the first hour of
 * the first thing an SDET or a build engineer does.
 *
 * Files are read from disk rather than pasted into a string so that what ships
 * to a customer is the same file this repository tests against and cannot
 * drift from it.
 */

/**
 * The file's contents. The name is checked against the manifest rather than
 * joined into a path, so nothing under `templates/` can be reached by asking
 * for it cleverly.
 */
export async function readCiTemplate(name: CiTemplateName) {
  const full = path.join(process.cwd(), "templates", CI_TEMPLATES[name].source);
  return readFile(full, "utf8");
}
