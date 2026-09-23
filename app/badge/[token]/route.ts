import { NextResponse } from "next/server";

import { badgeSvg, readBadgeState } from "@/lib/services/evidence-badge";

/**
 * The badge image. Always an image, whatever happened.
 *
 * A README that shows a broken image teaches people the product is broken, so
 * a stopped link, an expired one or a forged token all return a neutral
 * "unavailable" badge rather than an error. Caches and image proxies are
 * expected here, and five minutes is short enough that a failure shows up the
 * same morning.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const state = await readBadgeState(decodeURIComponent(token.replace(/\.svg$/, "")));
  return new NextResponse(badgeSvg(state), {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300",
      "x-robots-tag": "noindex",
    },
  });
}
