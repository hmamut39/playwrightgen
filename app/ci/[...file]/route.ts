import { NextResponse } from "next/server";

import { CI_TEMPLATES, isCiTemplate } from "@/lib/ci/templates";
import { readCiTemplate } from "@/lib/services/ci-templates";

/**
 * The pipeline files, downloadable.
 *
 * Public on purpose: they hold no secrets, only the names of the variables a
 * team sets in their own CI, and a build engineer should be able to fetch one
 * with curl from a machine that has never logged in. What is private is the
 * token, which stays on the project page and never appears here.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string[] }> }) {
  const { file } = await params;
  const name = file.map((part) => decodeURIComponent(part)).join("/");
  if (!isCiTemplate(name)) {
    return new NextResponse("No such file.", { status: 404, headers: { "cache-control": "no-store" } });
  }

  const template = CI_TEMPLATES[name];
  const body = await readCiTemplate(name).catch(() => null);
  if (body === null) {
    return new NextResponse("That file could not be read.", {
      status: 500,
      headers: { "cache-control": "no-store" },
    });
  }

  return new NextResponse(body, {
    headers: {
      "content-type": template.contentType,
      // Named for where it lands, not for the URL it came from.
      "content-disposition": `attachment; filename="${template.destination.split("/").pop()}"`,
      "cache-control": "public, max-age=300",
    },
  });
}
