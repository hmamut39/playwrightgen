/**
 * What this product asks of Clerk's own markup.
 *
 * The sign-in and sign-up screens are rendered by Clerk, inside our shell.
 * They are still our pages, so a fault on them is ours to answer even when
 * the element belongs to somebody else.
 *
 * Found on 2026-11-26 by running this product's own layout check across every
 * public page at six widths from 360 to 1920. These two screens were the only
 * ones left reporting anything, at every width:
 *
 *     a "Sign up" is 46x18px, under the 24x24px minimum in WCAG 2.2 (2.5.8)
 *     a "Sign in" is 42x18px, under the 24x24px minimum
 *     a "Clerk logo" is 48x14px, under the 24x24px minimum
 *
 * The first two are fixed here: `footerActionLink` is the "Already have an
 * account? Sign in" link, and padding grows its box without moving the text.
 *
 * The third is not fixed, and should not be. "Secured by Clerk" is Clerk's
 * own branding, which their free plan requires be displayed; hiding it to
 * satisfy a check would be trading somebody else's terms for a green result.
 * It stays, and it stays reported, which is the honest pair.
 */
export const CLERK_APPEARANCE = {
  elements: {
    /*
     * 18px of text, in a box the size of the text. Padding takes it to 26px
     * tall and keeps the line in the same place, which is the same fix the
     * site footer needed on the same day.
     */
    footerActionLink: "inline-flex items-center px-1 py-1 min-h-[26px]",
  },
} as const;
