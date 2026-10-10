import { CopyField } from "@/components/workspace/ci-setup-panel";

/**
 * The marker that attaches a CI result to this Test Case.
 *
 * A result is recorded only when the test title carries `[pwg:<version>]`.
 * PlaywrightGen writes it into code it generates, so nobody using the product
 * end to end ever needs to see it -- and a team with an existing Playwright
 * suite needs nothing else. Their tests are fine; they simply carry no marker,
 * so their first pipeline run records nothing. Until now the only place the
 * marker appeared was the MCP tool output, which is to say: nowhere a person
 * could find it.
 *
 * Shown for an unapproved version too, with what that means said plainly. A
 * marker that is hidden until approval sends somebody looking for a mistake
 * that is not there.
 */
export function VersionMarkerPanel({
  marker,
  versionNumber,
  approved,
  title,
}: {
  marker: string;
  versionNumber: number;
  approved: boolean;
  title: string;
}) {
  const shown = title.length > 48 ? `${title.slice(0, 48)}…` : title;

  return (
    <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
        Already have this test?
      </p>
      <h2 className="mt-2 text-lg font-semibold">Record its CI runs against this Test Case</h2>
      <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
        A result from your pipeline is attached to a Test Case by a marker in the
        test title. Code that PlaywrightGen writes already carries one. For a test
        that already lives in your repository, paste this at the start of its title
        and its runs attach to version {versionNumber} of this Test Case.
      </p>

      <div className="mt-5 max-w-xl">
        <CopyField label="Version marker" value={marker} />
      </div>

      <pre className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-xs leading-6 text-slate-700">
        {`test('${marker} ${shown}', async ({ page }) => {`}
      </pre>

      <p className="mt-3 max-w-3xl text-xs leading-5 text-slate-500">
        {approved
          ? "The marker names this exact version. When the Test Case changes, a new version gets a new marker, and results already recorded stay pinned to the version they ran against."
          : "This version is not approved yet. Results recorded against it are kept, but they do not count as approved coverage, and the evidence will say so."}
      </p>
    </section>
  );
}
