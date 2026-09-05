# Evals

Run with `npm run evals`. They are not part of `npm test` and CI does not run
them.

## Why they are separate

Evals call a real provider. Folding them into the ordinary test suite would make
a normal run non-deterministic and chargeable, and would create pressure to relax
an assertion to get a green build. Keeping them apart means a failing eval is a
signal about model behaviour, not an obstacle to merging.

They skip themselves when `OPENAI_API_KEY` is absent, so a contributor without a
key gets a skip rather than a confusing authentication error.

## How they grade

Deterministically, against the structured output. No model judges another model.
An LLM judge would add a second thing that can be wrong and would let a real
regression hide behind a sympathetic grader.

## What the first suite measures

`evals/failure-analysis.eval.ts` holds every evidence field constant except
`EXECUTION_HISTORY` and varies only that. A change in classification can
therefore only be attributed to the history, which is the property worth
protecting: the same failure text must be read differently depending on what
prior runs establish.

| Case | History states | Must not conclude |
| --- | --- | --- |
| `regression-history-is-not-flaky` | passed on an earlier revision, fails on a later one | flaky timing |
| `flaky-history-is-not-a-product-defect` | both outcomes on one revision | product defect |
| `absent-history-claims-neither` | no comparable prior evidence | — |
| `changed-intent-is-not-a-regression` | passing evidence only on another version | — |

Every finding must also quote its cited evidence field verbatim. The production
path enforces that too, and an eval that skipped the check would let a fabricated
quote count as a pass.

First recorded result, 2026-09-05, `gpt-5-mini`: 4 of 4 passed.

## Automation generation

`evals/automation-generation.eval.ts` targets what
`validateAutomationGeneration` cannot check. The validator already rejects unsafe
primitives, missing assertions, wrong fixtures, and brittle locators, and it runs
in production, so re-running it would measure nothing new. These cases test the
judgement calls instead.

| Case | Asserts |
| --- | --- |
| `browser-passes-validation` | a well-specified browser request produces no blocking findings |
| `api-uses-request-fixture` | an API request uses `request`/`APIRequestContext`, not a page |
| `underspecified-declares-assumptions` | a request with no URL, selectors, or credentials surfaces assumptions rather than inventing them |
| `no-hard-waits-or-brittle-locators` | no `waitForTimeout`, no DOM-coupled locators |

The last two matter most. Inventing a plausible base URL and login form would
produce code that looks correct and fails in a way nobody can explain, and hard
waits and brittle locators are warnings rather than blocks in production, so a
drift toward them would ship silently without this measurement.

This suite matters more than the analysis one because its output is executed by
customers: a bad generation costs a CI run and a confusing failure, not merely a
bad read.

First recorded result, 2026-09-05, `gpt-5-mini`: 4 of 4 passed.

## Adding a case

Prefer cases that isolate one variable. A case that changes several fields at
once cannot tell you which one moved the answer, so it measures nothing useful
when it later fails.

Record the model and the pass rate whenever the prompt, the schema, or the model
changes, so the effect of a change is visible rather than assumed.

## Not yet covered

Requirement Review, Coverage Review, and Quick Generation have no eval suite.
Requirement Review is the most valuable one to add next, because its suggestions
shape the approved intent everything downstream is measured against.
