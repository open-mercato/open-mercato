# Run the Suite and Diagnose Failures

Use this when the user only wants to run integration tests (full suite, category, or a single file) — skip the authoring phases and execute the requested run directly. If a run fails, apply the failure-analysis section below.

## Commands

| Action | Command |
|--------|---------|
| Run all tests | `npx playwright test --config .ai/qa/tests/playwright.config.ts` |
| Run single test | `npx playwright test --config .ai/qa/tests/playwright.config.ts <path>` |
| Debug (fail-fast) | `npx playwright test --config .ai/qa/tests/playwright.config.ts <path> --retries=0` |
| View report | `npx playwright show-report .ai/qa/test-results/html` |
| Test files location | `src/modules/<module>/__integration__/TC-XXX.spec.ts` |
| Scenario sources (optional) | `.ai/qa/scenarios/TC-XXX-*.md` |

## Runtime Policy

Default QA runtime policy:
- Keep global settings in `.ai/qa/tests/playwright.config.ts`:
  - `timeout: 20_000`
  - `expect.timeout: 20_000`
  - `retries: 1`
- Do not add per-test timeout or retry overrides in `.spec.ts` files (`test.setTimeout`, `test.describe.configure({ retries })`, `test.retry`).

Debug/development policy (fail fast while authoring/fixing tests):
- Override retries at command level with `--retries=0`.
- Do not edit global config just to debug a single test.

## Failure Analysis and User Reporting (Mandatory on Failures)

After any failed test run (single test or suite), analyze failure artifacts before responding:

1. Parse terminal output to capture the failing test names and first error stack/assertion.
2. Inspect Playwright artifacts for each failed test from `test-results/`:
   - `error-context.md`
   - Screenshots (expected/actual/diff where available)
   - Trace/video attachments if present
3. Classify each failure into one primary reason:
   - Product regression / real app bug
   - Test issue (stale locator, brittle assertion, bad fixture/cleanup)
   - Environment / data issue (service unavailable, auth/session drift)
4. Decide ownership per failing test:
   - `User/Product team` when behavior looks like a real regression
   - `Agent/QA` when failure is test-code quality, selector drift, or fixture instability
   - `Shared` when both product behavior and test assumptions need adjustment
5. Respond with a table (required format) before any optional narrative:

| Failing test | Evidence used | Reasoning (why it failed) | Suggested owner | Next action |
|--------------|---------------|---------------------------|-----------------|-------------|
| `<path>::<test name>` | `stdout + screenshot` | `Concise diagnosis` | `User/Product` / `Agent/QA` / `Shared` | `Fix recommendation` |

Do not provide a generic "tests failed" summary without per-test reasoning.
