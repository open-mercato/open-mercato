---
name: integration-tests
description: Run and create QA integration tests (Playwright TypeScript), including executing the full suite, converting optional markdown scenarios, and generating new tests from specs or feature descriptions. Use when the user says "run integration tests", "test this feature", "create test for", "convert test case", "run QA tests", or "integration test".
---

# Integration Tests Skill

This skill generates executable Playwright tests in module-local `__integration__` directories (for example `packages/core/src/modules/sales/__integration__/TC-SALES-*.spec.ts`) by exploring the running application. It also covers running existing integration tests after feature/bug implementation and reporting failures with artifact-based diagnosis. It optionally produces a markdown scenario (`.ai/qa/scenarios/TC-*.md`) for documentation — the scenario is **not required**.

## Quick Reference

| Action | Command |
|--------|---------|
| Run all tests | `yarn test:integration` |
| Run single test | `npx playwright test --config .ai/qa/tests/playwright.config.ts <path>` |
| Run in ephemeral containers | `yarn test:integration:ephemeral` |
| Run interactive ephemeral mode | `yarn test:integration:ephemeral:interactive` |
| Start ephemeral app only (for MCP exploration, tests development, and debugging) | `yarn test:integration:ephemeral:start` |
| View report | `yarn test:integration:report` |
| Test files location | `<module>/__integration__/TC-XXX.spec.ts` (legacy `.ai/qa/tests` still supported) |
| Scenario sources (optional) | `.ai/qa/scenarios/TC-XXX-*.md` |
| Reusable env state file | `.ai/qa/ephemeral-env.json` |

## Runtime Policy

Default QA runtime policy:
- Keep global settings in `.ai/qa/tests/playwright.config.ts`:
  - `timeout: 10_000`
  - `expect.timeout: 10_000`
  - `retries: 1`
- Do not add per-test timeout or retry overrides in `.spec.ts` files (`test.setTimeout`, `test.describe.configure({ retries })`, `test.retry`).

Debug/development policy (fail fast while authoring/fixing tests):
- Override retries at command level with `--retries=0`.
- Do not edit global config just to debug a single test.

## Workflow

### Phase 1 — Identify What to Test

Determine the feature scope from one of these sources (in priority order):

1. **Spec file**: If a spec is referenced or was just implemented, read it from `.ai/specs/SPEC-*.md`. Extract testable scenarios from the API Contracts, UI/UX, and Data Models sections.
2. **User description**: If the user describes a feature ("test the company creation flow"), map it to the relevant module and pages.
3. **Recent changes**: If triggered after implementation, use `git diff` or recent commits to identify changed endpoints, pages, and components.

For each feature, identify:
- Which **category** it belongs to (AUTH, CAT, CRM, SALES, ADMIN, INT, API-*)
- Whether it's a **UI test** or **API test**
- The **priority** (High for CRUD operations, Medium for settings/config, Low for edge cases)
- The **prerequisite role** (superadmin, admin, or employee)

### Phase 2 — Find the Next TC Number

List existing test cases in the target category to determine the next sequential number:

```bash
ls .ai/qa/scenarios/TC-{CATEGORY}-*.md 2>/dev/null | sort | tail -1
find apps packages .ai/qa/tests -type f -name "TC-{CATEGORY}-*.spec.ts" 2>/dev/null | sort | tail -1
```

Use the highest number found across both directories, then increment. For example, if the last scenario is TC-CRM-011 but the last test is TC-CRM-013, use TC-CRM-014.

### Phase 3 — Reuse Existing Ephemeral Environment First

Before starting any new ephemeral app, read `.ai/qa/ephemeral-env.json`.

- If it exists and contains `status: running`, use `base_url` from that file.
- If it does not exist (or cannot be reused), start:

```bash
yarn test:integration:ephemeral:start
```

Default ephemeral app port is `5001` when available; fallback port is recorded in `.ai/qa/ephemeral-env.json`.

### Phase 4 — Explore the Feature via Playwright MCP

Use the active base URL from `.ai/qa/ephemeral-env.json` for MCP navigation, then discover the actual UI:

1. Login with the appropriate role
2. Navigate to the relevant page
3. Take snapshots to identify exact element labels, button text, form fields
4. Walk through the happy path to discover the actual flow
5. Note any validation messages, success states, redirects

For API tests, use cURL to discover:
1. The exact endpoint path and method
2. Required request headers and body shape
3. The actual response structure
4. Error responses for invalid inputs

### Phase 5 — Write the Playwright Test

Create the test in the module where the behavior lives:

- Core/shared module: `packages/<package>/src/modules/<module>/__integration__/TC-{CATEGORY}-{XXX}.spec.ts`
- App-specific module: `apps/mercato/src/modules/<module>/__integration__/TC-{CATEGORY}-{XXX}.spec.ts`
- Create-app template module: `packages/create-app/template/src/modules/<module>/__integration__/TC-{CATEGORY}-{XXX}.spec.ts`
- Enterprise overlay test: `packages/enterprise/modules/<module>/__integration__/TC-{CATEGORY}-{XXX}.spec.ts`
  - Only create enterprise overlay tests as additions to modules that already have base module tests.
  - Do not add dependencies from base code to the enterprise package.
  - Subfolders inside `__integration__` are supported.

Use the locators discovered in Phase 3 (not guessed). If a scenario was written, reference it in a comment.
Do not hardcode entity IDs in routes, payloads, or assertions. Resolve entities dynamically at runtime by creating fixtures through API/UI steps or by selecting existing rows via stable UI text/role locators.

Metadata for conditional test enablement:

- Helpers:
  - Put shared helpers in a central reusable location (recommended: `packages/core/src/modules/core/__integration__/helpers/`).
  - Module-local `__integration__/helpers/` files should re-export central helpers where possible.

- Folder-level metadata:
  - Add `meta.ts` or `index.ts` anywhere under `__integration__/`.
  - Supported keys: `dependsOnModules`, `requiredModules`, `requiresModules`.
  - Example:

```ts
export const integrationMeta = {
  description: 'Billing integration coverage',
  dependsOnModules: ['sales', 'currencies'],
}
```

- Per-test metadata:
  - Add metadata directly inside the `.spec.ts` file using the same keys, or create sibling file `TC-XXX.meta.ts`.
  - Example sibling file:

```ts
export const integrationMeta = {
  dependsOnModules: ['catalog'],
}
```

- Evaluation model:
  - Dependencies inherit from `__integration__/` root through nested subfolders and then per-test metadata is applied.
  - If any required module is not enabled in the app, matching tests are skipped automatically (excluded from discovery/run).

### Phase 6 — Optionally Write the Markdown Scenario

If documentation is desired, create `.ai/qa/scenarios/TC-{CATEGORY}-{XXX}-{slug}.md` using the template:

```markdown
# Test Scenario [NUMBER]: [TITLE]

## Test ID
TC-{CATEGORY}-{XXX}

## Category
{Category Name}

## Priority
{High/Medium/Low}

## Type
{UI Test / API Test}

## Description
{What this test validates — derived from spec or feature description}

## Prerequisites
- User is logged in as {role}
- {Other prerequisites from spec}

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | {Discovered action} | {Observed result} |
| 2 | {Discovered action} | {Observed result} |

## Expected Results
- {Derived from spec's API Contracts or UI/UX section}

## Edge Cases / Error Scenarios
- {Derived from spec's Risks section or discovered during exploration}
```

Fill steps with **actual** actions and results observed during Phase 3, not hypothetical ones.

This step is **optional** — skip it if the user only wants the executable test.

### Phase 7 — Verify

Run the new test to confirm it passes:

```bash
npx playwright test --config .ai/qa/tests/playwright.config.ts <path-to-test-file>
```

When developing/debugging the test, run fail-fast with no retries:

```bash
npx playwright test --config .ai/qa/tests/playwright.config.ts <path-to-test-file> --retries=0
```

If it fails, fix it. Do not leave broken tests.

### Shared — Failure Analysis and User Reporting (Mandatory on Failures)

After any failed test run (single test or suite), analyze failure artifacts before responding. This shared section applies both when:
- writing/updating tests
- only running existing tests after implementing features or bug fixes

1. Parse terminal output to capture the failing test names and first error stack/assertion.
2. Inspect Playwright artifacts for each failed test from `test-results/` and the HTML report:
   - `error-context.md`
   - screenshots (expected/actual/diff where available)
   - trace/video attachments if present
3. Classify each failure into one primary reason:
   - Product regression / real app bug
   - Test issue (stale locator, brittle assertion, bad fixture/cleanup)
   - Environment / data issue (service unavailable, auth/session drift, shared-state collision)
4. Decide ownership per failing test:
   - `User/Product team` when behavior looks like a real regression or requirement mismatch
   - `Agent/QA` when failure is test-code quality, selector drift, or fixture instability
   - `Shared` when both product behavior and test assumptions need adjustment
5. Respond with a table (required format) before any optional narrative:

| Failing test | Evidence used | Reasoning (why it failed) | Suggested owner | Next action |
|--------------|---------------|---------------------------|-----------------|-------------|
| `<path>::<test name>` | `stdout + screenshot + error-context` | `Concise technical diagnosis` | `User/Product team` / `Agent/QA` / `Shared` | `Concrete fix recommendation` |

Do not provide a generic "tests failed" summary without per-test reasoning.

### Running-Only Mode (No New Test Authoring)

If the user asks only to run integration tests (full suite/category/single file), skip authoring phases and execute the requested run directly.  
If the run fails, apply the shared failure-analysis section above.

## Rules

- MUST explore the running app before writing — never guess selectors or flows
- MUST check `.ai/qa/ephemeral-env.json` first and reuse existing environment when available
- MUST use the active URL from `.ai/qa/ephemeral-env.json` (never assume `localhost:3000`)
- MUST NOT hardcode record IDs (UUIDs/PKs) in generated tests
- MUST discover or create test entities at runtime, then navigate using discovered links/URLs
- MUST NOT rely on seeded/demo data for prerequisites
- MUST create required fixtures per test (prefer API fixture setup for stability)
- MUST clean up any data created by the test in `finally`/teardown
- MUST keep tests deterministic and isolated from run order or retries
- MUST NOT add per-test timeout/retry overrides in `.spec.ts`; rely on global Playwright config (`timeout: 10s`, `expect.timeout: 10s`, `retries: 1`)
- MUST create the `.spec.ts` — the markdown scenario is optional
- MUST use actual locators from Playwright MCP snapshots (`getByRole`, `getByLabel`, `getByText`)
- MUST verify the test passes before finishing
- MUST analyze failed test artifacts (`stdout`, `error-context.md`, screenshots/report) before reporting failures
- MUST report failures in a per-test table that includes reason, evidence, and suggested owner
- MUST apply the same failure-analysis and table-reporting rules when only running existing tests after implementation work
- MUST place new tests in module-local `__integration__` directories; use legacy `.ai/qa/tests/` only when there is no module context
- MUST keep helper utilities next to tests under `<module>/__integration__/helpers/` (avoid cross-module helper imports)
- MUST treat `packages/enterprise/modules/<module>/__integration__/` as an optional overlay and keep base code independent from enterprise
- MUST use `meta.ts` or `index.ts` dependency metadata for module-gated folders and per-test `.meta.ts` (or in-file metadata) for individual gating
- When deriving from a spec, focus on the happy path first, then add edge cases as separate test cases if they warrant it
- Each test file covers one scenario — create multiple files for multiple scenarios

## Deriving Scenarios from a Spec

When reading a spec, extract test scenarios from these sections:

| Spec Section | Generates |
|-------------|-----------|
| API Contracts — each endpoint | One API test per endpoint (CRUD) |
| UI/UX — each user flow | One UI test per flow |
| Edge Cases / Error Scenarios | One test per significant error path |
| Risks & Impact Review | Regression tests for documented failure modes |

Typical spec produces 3-8 test cases. Prioritize:
1. **High**: CRUD happy paths, authentication, authorization
2. **Medium**: Validation errors, edge cases with business impact
3. **Low**: Cosmetic, minor UX edge cases

## Example

Given SPEC-017 (Version History Panel), the skill would produce:

- `packages/core/src/modules/admin/__integration__/TC-ADMIN-011.spec.ts` — UI: open history panel on an entity
- `packages/core/src/modules/admin/__integration__/TC-API-AUD-007.spec.ts` — API: fetch audit logs for entity
- `packages/core/src/modules/admin/__integration__/TC-ADMIN-012.spec.ts` — UI: restore a previous version
- Optionally: matching `.ai/qa/scenarios/TC-ADMIN-011-*.md` files for documentation

## Running Existing Tests

```bash
# Run all integration tests headlessly (zero token cost)
yarn test:integration

# Run tests matching a module/category path fragment
npx playwright test --config .ai/qa/tests/playwright.config.ts sales

# Run a single test
npx playwright test --config .ai/qa/tests/playwright.config.ts packages/core/src/modules/auth/__integration__/TC-AUTH-001.spec.ts

# Run fail-fast in local debugging
npx playwright test --config .ai/qa/tests/playwright.config.ts packages/core/src/modules/auth/__integration__/TC-AUTH-001.spec.ts --retries=0

# Run in ephemeral containers (Docker required)
yarn test:integration:ephemeral

# Preferred for short local loops (reused ephemeral app + DB)
yarn test:integration:ephemeral:interactive
```

## Batch Conversion

When converting multiple scenarios at once:

1. List unconverted scenarios by comparing `.ai/qa/scenarios/` vs discovered `**/__integration__/**/*.spec.ts` (plus legacy `.ai/qa/tests/**/*.spec.ts`)
2. Convert one category at a time
3. Run the full suite after each category to catch cross-test issues
4. Report summary: total converted, passed, failed
