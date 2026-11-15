/**
 * What /api/health actually said, read with its own vocabulary.
 *
 * The production watcher's first step asked each component for `part.status`
 * and failed the run when it was anything but "healthy". No component has a
 * `status`. They carry `state`, one of "up", "down", "configured" or
 * "missing", and `critical`. So the filter matched nothing, every run, and
 * the step reported `5 components healthy` -- a count of components, dressed
 * up as a verdict about them. It would have said the same with the database
 * down.
 *
 * It was found on 2026-11-15 by printing the endpoint's own JSON while
 * checking something else, the day after the watcher was written and after it
 * had reported five green runs. A watcher is the one thing that cannot be
 * taken on trust: nobody checks the thing that does the checking, so it has
 * to be the most tested code in the repository rather than the least. This
 * file exists so the judgement can be tested without a deployment.
 *
 * The 503 saved it from being worthless. A critical component that is down or
 * missing makes the report "degraded", which the route answers 503 to, and
 * the step already failed on a non-200. What it could not see was a
 * non-critical component that is down -- the report stays "healthy", the
 * route answers 200, and nothing anywhere said a part of the product had
 * stopped.
 */

/** States that mean a component answered for itself. */
const WORKING = new Set(["up", "configured"]);

/**
 * @param {{ ok: boolean, status: number, body: unknown }} response
 * @returns {{ ok: boolean, why?: string, note?: string }}
 */
export function healthVerdict(response) {
  const { ok, status, body } = response;

  if (!ok) {
    const said =
      body && typeof body === "object" && typeof (/** @type {any} */ (body).status) === "string"
        ? `, reporting ${/** @type {any} */ (body).status}`
        : "";
    return { ok: false, why: `GET /api/health answered ${status}${said}` };
  }

  if (!body || typeof body !== "object") {
    return { ok: false, why: "GET /api/health answered 200 with no JSON object in it" };
  }

  const report = /** @type {{ status?: unknown, components?: unknown }} */ (body);
  const components = Array.isArray(report.components) ? report.components : [];

  // A 200 that does not say "healthy" is a contradiction, and trusting the
  // code over the body is how a monitor ends up agreeing with a broken
  // deployment.
  if (report.status !== "healthy") {
    return {
      ok: false,
      why: `GET /api/health answered 200 but reports ${JSON.stringify(report.status)}`,
    };
  }

  if (components.length === 0) {
    return { ok: false, why: "the health report lists no components, so it checked nothing" };
  }

  const named = (list) => list.map((part) => `${part.name} ${part.state}`).join(", ");

  const broken = components.filter((part) => part.critical && !WORKING.has(part.state));
  if (broken.length > 0) {
    // Reachable even on a 200: it means the report called itself healthy with
    // a critical component down, which is worth saying in those words.
    return {
      ok: false,
      why: `reports healthy, but ${named(broken)} -- and ${broken.length === 1 ? "that one is" : "those are"} critical`,
    };
  }

  // Not critical, so not an outage, and not nothing either. Said in the note
  // so that a part of the product going quiet cannot pass as "all healthy".
  const degraded = components.filter((part) => !WORKING.has(part.state));
  if (degraded.length > 0) {
    return {
      ok: true,
      note: `${components.length - degraded.length} of ${components.length} components working; ${named(degraded)} (not critical)`,
    };
  }

  return { ok: true, note: `${components.length} components working` };
}
