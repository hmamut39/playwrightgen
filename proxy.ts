import { clerkMiddleware } from "@clerk/nextjs/server";

import { validateServerClerkEnvironment } from "@/lib/env";

/**
 * Clerk has to run wherever a route reads the session.
 *
 * The matcher listed the workspace pages and the GitHub setup routes, and left
 * out every billing route. Those routes call requireWorkspaceContext, which
 * calls Clerk's auth(), which throws when the middleware has not run -- so
 * checkout failed for every user from the day it was written, with a message
 * about Clerk that surfaced to the person as "billing could not be opened".
 *
 * Adding a route here is therefore not optional configuration: any route that
 * reads the session must appear, or it fails at runtime rather than at build.
 */

/**
 * Routes answered by fetch rather than by navigation.
 *
 * These authorize themselves and reply with JSON, so the middleware must not
 * redirect them to a sign-in page: the caller would receive an HTML document
 * where it expected JSON and report a generic failure, which is exactly the
 * kind of error that takes an afternoon to trace.
 */
const JSON_ROUTES = [
  "/api/billing-portal",
  "/api/check-pro",
  "/api/checkout",
  "/api/checkout-session",
];

export default clerkMiddleware(async (auth, request) => {
  validateServerClerkEnvironment();

  if (JSON_ROUTES.some((route) => request.nextUrl.pathname.startsWith(route))) {
    // Clerk is now initialised for this request; the route decides who may
    // proceed and answers in the shape its caller expects.
    return;
  }

  const signInUrl = new URL("/sign-in", request.url);
  signInUrl.searchParams.set("redirect_url", request.url);

  await auth.protect({ unauthenticatedUrl: signInUrl.toString() });
});

export const config = {
  matcher: [
    "/workspace",
    "/workspace/:path*",
    "/api/github/setup/:path*",
    "/api/billing-portal",
    "/api/check-pro",
    "/api/checkout",
    "/api/checkout-session",
  ],
};
