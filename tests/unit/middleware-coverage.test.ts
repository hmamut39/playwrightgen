import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { config } from "@/proxy";

/**
 * Every route that reads the session must be covered by the middleware.
 *
 * Clerk's auth() throws when clerkMiddleware has not run for the request, and
 * nothing catches that at build time: the route compiles, deploys, and fails
 * the first time somebody uses it. That is exactly what happened to checkout,
 * which was broken from the day it was written and reported to the person as
 * "billing could not be opened" -- a message that named neither Clerk nor the
 * matcher.
 *
 * So the matcher is checked against the filesystem rather than trusted. Adding
 * an authenticated API route without listing it here now fails a test instead
 * of failing a customer.
 */

const API_ROOT = join(process.cwd(), "app", "api");

function routeFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...routeFiles(path));
    } else if (entry === "route.ts") {
      found.push(path);
    }
  }
  return found;
}

/** "app/api/checkout/route.ts" -> "/api/checkout" */
function urlPathFor(file: string): string {
  return (
    "/api" +
    file
      .slice(API_ROOT.length)
      .replace(/\\/g, "/")
      .replace(/\/route\.ts$/, "")
  );
}

/** Applies the subset of Next's matcher syntax this project uses. */
function matches(pattern: string, path: string): boolean {
  if (pattern.endsWith("/:path*")) {
    const prefix = pattern.slice(0, -"/:path*".length);
    return path === prefix || path.startsWith(`${prefix}/`);
  }
  return pattern === path;
}

describe("middleware covers every authenticated API route", () => {
  const authenticated = routeFiles(API_ROOT)
    .filter((file) => readFileSync(file, "utf8").includes("requireWorkspaceContext"))
    .map(urlPathFor)
    .sort();

  it("finds the routes that read the session", () => {
    // A guard on the guard: if this ever returns nothing, the check above
    // would pass by testing nothing at all.
    expect(authenticated.length).toBeGreaterThan(0);
  });

  it("lists each of them in the matcher", () => {
    const uncovered = authenticated.filter(
      (path) => !config.matcher.some((pattern) => matches(pattern, path)),
    );

    expect(
      uncovered,
      `These routes call requireWorkspaceContext but are not matched by the middleware, so Clerk's auth() will throw the first time each is used: ${uncovered.join(", ")}`,
    ).toEqual([]);
  });

  it("matches a nested route through a wildcard", () => {
    expect(matches("/api/github/setup/:path*", "/api/github/setup/callback")).toBe(true);
    expect(matches("/api/checkout", "/api/checkout")).toBe(true);
    expect(matches("/api/checkout", "/api/checkout-session")).toBe(false);
  });
});
