/**
 * The response headers every browser is told, and where they apply.
 *
 * Kept here rather than inline in `next.config.ts` so the claim on /about and
 * the configuration that makes it true are the same list, read by the same
 * test. A security claim in one file and the thing it describes in another is
 * how the sending address came to be written three times and changed once.
 *
 * Checked from outside on 2026-11-21: the platform already sends
 * `Strict-Transport-Security: max-age=63072000` and nothing else. Without
 * these, a browser was free to sniff a response into a type it was never sent
 * as, to put any page of this product in a frame on any site, and to hand the
 * full path of a workspace page -- organization, project and artifact ids --
 * to whatever a person clicked through to.
 *
 * There is no Content-Security-Policy. It is the one on this list that can
 * break sign-in or checkout for everybody at once, and it needs the script
 * sources of Clerk, Stripe and the platform enumerated and then kept correct.
 * It is worth doing properly rather than at the end of an afternoon, so the
 * posture on /about states plainly that there is none.
 */

export type ResponseHeader = { key: string; value: string };

export const SECURITY_HEADERS: ResponseHeader[] = [
  // A response is the type it says it is.
  { key: "X-Content-Type-Options", value: "nosniff" },
  /**
   * The path of a workspace page carries the organization, the project and
   * the artifact. Cross-origin, only the origin travels; on this site's own
   * links the full path still does, because the product needs it.
   */
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  /**
   * Nothing here is meant to be framed by another site, and nothing in this
   * product renders an iframe -- checked across app/ and components/ before
   * setting this. SAMEORIGIN rather than DENY so the product can still frame
   * its own pages if a reason appears.
   */
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Hardware this product has never asked for and must not be able to ask
  // for quietly.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

/** Where they apply, in the shape Next's `headers()` returns. */
export const SECURITY_HEADER_RULES = [
  {
    // Everything except the framework's own paths.
    source: "/((?!_next/).*)",
    headers: SECURITY_HEADERS,
  },
  {
    /*
     * The built assets, covered rather than left out: a script served as the
     * wrong type is where nosniff matters most. The rest of the list is about
     * documents and would mean nothing here.
     */
    source: "/_next/static/:path*",
    headers: [{ key: "X-Content-Type-Options", value: "nosniff" }],
  },
];

/*
 * A note about the dev server, kept because it cost an hour and would cost it
 * again.
 *
 * Loading /about with these in place showed one console error on every run:
 *
 *     WebSocket connection to 'ws://127.0.0.1:3002/_next/hmr?id=...' failed:
 *     Error during WebSocket handshake: net::ERR_INVALID_HTTP_RESPONSE
 *
 * That is the socket `next dev` uses to push edits into the browser, so it
 * read exactly like these headers having killed hot reload. Four loads with
 * them, all broken; two without, both clean -- and on that evidence the
 * headers were disabled in development and a long comment written about why.
 *
 * The evidence was too small. Counted properly, six loads at a time: four of
 * six broken with the headers, three of six broken with next.config.ts
 * restored to the version that has never had a headers() function at all.
 * The failure is intermittent, it predates this, and it belongs to the
 * headless browser and the dev server rather than to anything here. A curl
 * upgrade returns 101 throughout and never reproduces it.
 *
 * So the headers apply everywhere, in development too, and the real finding
 * is the measurement: four out of four is not a rate, and a difference
 * against an unmeasured baseline is not a cause. Worth remembering the next
 * time something "clearly" broke -- including the next time it is mine.
 */
