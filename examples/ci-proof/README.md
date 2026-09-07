# Prove the PlaywrightGen CI loop

Pushing this repository runs a Playwright test on GitHub Actions and reports the
result back to PlaywrightGen as immutable evidence. It exists to prove the whole
chain end to end: your tests run on your runners, against your environment, with
your secrets, and only a bounded summary of the results is sent anywhere.

Nothing here is required to use PlaywrightGen. It is a disposable repository you
can delete once you have seen a run appear in your workspace.

## 1. Get your four values from PlaywrightGen

Open your project, then the **Repositories** tab. Copy these:

| PlaywrightGen shows | Add to GitHub as |
| --- | --- |
| `PLAYWRIGHTGEN_TOKEN` | a repository **secret** |
| `PLAYWRIGHTGEN_ORG_ID` | a repository **variable** |
| `PLAYWRIGHTGEN_PROJECT_ID` | a repository **variable** |
| `PLAYWRIGHTGEN_URL` | a repository **variable** |

The token is a credential: it authorises writing test evidence to this project
and nothing else. Treat it like a password and never commit it.

## 2. Get your test code from PlaywrightGen

In your project, approve a Requirement, approve a Test Case, then open the
**Automation** tab and generate automation for it.

Copy the generated code into `tests/generated.spec.ts` in this repository.

**Copy it exactly.** The test title contains a marker that looks like
`[pwg:0f8c...]`. That marker is how a result finds the approved version it is
evidence for. Remove it and the run is reported but matched to nothing, which
shows up in your workspace as an unmatched result rather than an error.

## 3. Create the GitHub repository

Create a new empty repository on GitHub, then from this folder:

`package-lock.json` is committed on purpose. The workflow runs `npm ci` and
`actions/setup-node` caches against a lock file, and both fail outright without
one -- in under fifteen seconds, before a single test runs.

```bash
npm install
git init
git add -A
git commit -m "PlaywrightGen CI proof"
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Add the secret and the three variables under
**Settings → Secrets and variables → Actions** before or after the first push;
the workflow reads them at run time.

## 4. Watch it run

The **Actions** tab shows the workflow. When it finishes, your project's
**Test Runs** tab in PlaywrightGen has a new attempt, pinned to the approved
version, with the commit it ran against.

## 5. Prove the artifact path as well

A passing run captures nothing, because there is nothing to explain. To see
traces and screenshots arrive, make the test fail on purpose: add a line to
`tests/generated.spec.ts` that cannot be true, for example

```ts
await expect(page).toHaveTitle("this title does not exist");
```

Push again. The failed attempt in PlaywrightGen now carries **Trace** and
**Screenshot** links beside the workflow link. The trace is a downloadable
archive rather than a page; open it with:

```bash
npx playwright show-trace <file>
```

Remove the failing line afterwards, or delete the repository.

## What to expect if something does not arrive

- **Nothing appears in Test Runs.** Open the Actions log for the reporting step.
  It prints the status the ingest endpoint returned.
- **The run appears but matches nothing.** The `[pwg:...]` marker is missing or
  was edited. Copy the generated code again without changing the title.
- **The reporting step says 401.** The token is wrong, or it was rotated in
  PlaywrightGen after being copied. Copy it again from the Repositories tab.
