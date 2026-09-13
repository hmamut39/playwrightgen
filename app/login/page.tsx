import { redirect } from "next/navigation";

/**
 * The old address for signing in.
 *
 * This was a placeholder from before real accounts existed: it stored an
 * email in the browser and let anyone "in". Nothing links to it any more, but
 * old bookmarks and search results do, and landing on a fake sign-in form is
 * worse than landing on the real one.
 */
export default function LegacyLoginPage() {
  redirect("/sign-in");
}
