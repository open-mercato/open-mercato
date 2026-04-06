---
name: integration-tests
description: Run and create QA integration tests (Playwright TypeScript), including executing the full suite, converting optional markdown scenarios, and generating new tests from specs or feature descriptions. Use when the user says "run integration tests", "test this feature", "create test for", "convert test case", "run QA tests", or "integration test".
---

# Integration Tests Skill

This skill generates executable Playwright tests in module-local `__integration__` directories (for example `src/modules/sales/__integration__/TC-SALES-*.spec.ts`) by exploring the running application. It also covers running existing integration tests after feature/bug implementation and reporting failures with artifact-based diagnosis. It optionally produces a markdown scenario (`.ai/qa/scenarios/TC-*.md`) for documentation — the scenario is **not required**.

## Quick Reference

| Action | Command |
|--------|---------|
| Run all tests | `npx playwright test --config .ai/qa/playwright.config.ts` |
| Run single test | `npx playwright test --config .ai/qa/playwright.config.ts <path>` |
| Debug (fail-fast) | `npx playwright test --config .ai/qa/playwright.config.ts <path> --retries=0` |
| View report | `npx playwright show-report .ai/qa/test-results/html` |
| Test files location | `src/modules/<module>/__integration__/TC-XXX.spec.ts` |
| Scenario sources (optional) | `.ai/qa/scenarios/TC-XXX-*.md` |

## Runtime Policy

Default QA runtime policy:
- Keep global settings in `.ai/qa/playwright.config.ts`:
  - `timeout: 20_000`
  - `expect.timeout: 20_000`
  - `retries: 1`
- Do not add per-test timeout or retry overrides in `.spec.ts` files (`test.setTimeout`, `test.describe.configure({ retries })`, `test.retry`).

Debug/development policy (fail fast while authoring/fixing tests):
- Override retries at command level with `--retries=0`.
- Do not edit global config just to debug a single test.

## Workflow

### Phase 1 — Identify What to Test

Determine the feature scope from one of these sources (in priority order):

1. **Spec file**: If a spec is referenced or was just implemented, read it from `.ai/specs/*.md`. Extract testable scenarios from the API Contracts, UI/UX, and Data Models sections.
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
find src/modules -type f -name "TC-{CATEGORY}-*.spec.ts" 2>/dev/null | sort | tail -1
```

Use the highest number found across both directories, then increment. For example, if the last scenario is TC-CRM-011 but the last test is TC-CRM-013, use TC-CRM-014.

### Phase 3 — Verify the Dev Server Is Running

Before writing or running tests, ensure the app is running:

1. Check if `yarn dev` is active (the app should be listening on `http://localhost:3000` or the `BASE_URL` configured in `.env`).
2. If not running, tell the user to start it: `yarn dev`.
3. Use the base URL from `.env` or default to `http://localhost:3000`.

### Phase 4 — Explore the Feature via Playwright MCP

Use the active base URL for MCP navigation, then discover the actual UI:

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

```
src/modules/<module>/__integration__/TC-{CATEGORY}-{XXX}.spec.ts
```

Use the locators discovered in Phase 4 (not guessed). If a scenario was written, reference it in a comment.
Do not hardcode entity IDs in routes, payloads, or assertions. Resolve entities dynamically at runtime by creating fixtures through API/UI steps or by selecting existing rows via stable UI text/role locators.

**Helpers**: Import shared helpers from `@open-mercato/core/helpers/integration/*`:

```typescript
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
```

| Helper Import | Main Exports | Typical Use |
|------|-------|--------|
| `@open-mercato/core/helpers/integration/auth` | `login`, `DEFAULT_CREDENTIALS` | UI authentication and role-based login |
| `@open-mercato/core/helpers/integration/api` | `getAuthToken`, `apiRequest` | Authenticated API calls in integration tests |
| `@open-mercato/core/helpers/integration/crmFixtures` | `createCompanyFixture`, `createPersonFixture`, `deleteEntityIfExists` | CRM fixture lifecycle |
| `@open-mercato/core/helpers/integration/catalogFixtures` | `createProductFixture`, `deleteCatalogProductIfExists` | Catalog fixture lifecycle |
| `@open-mercato/core/helpers/integration/salesFixtures` | `createSalesQuoteFixture`, `createSalesOrderFixture` | Sales fixture lifecycle |
| `@open-mercato/core/helpers/integration/authFixtures` | `createRoleFixture`, `createUserFixture` | Role and user fixture lifecycle |
| `@open-mercato/core/helpers/integration/generalFixtures` | `readJsonSafe`, `expectId` | General-purpose test utilities |

**Metadata for conditional test enablement**:

- Folder-level metadata (`__integration__/meta.ts`):

```ts
export const integrationMeta = {
  description: 'Sales flows requiring currencies',
  dependsOnModules: ['sales', 'currencies'],
}
```

- Per-test metadata (sibling `.meta.ts` file):

```ts
export const integrationMeta = {
  dependsOnModules: ['catalog'],
}
```

If any required module is not enabled in the app, matching tests are skipped automatically.

### Phase 6 — Optionally Write the Markdown Scenario

If documentation is desired, create `.ai/qa/scenarios/TC-{CATEGORY}-{XXX}-{slug}.md` using this template:

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

Fill steps with **actual** actions and results observed during Phase 4, not hypothetical ones.

This step is **optional** — skip it if the user only wants the executable test.

### Phase 7 — Verify

Run the new test to confirm it passes:

```bash
npx playwright test --config .ai/qa/playwright.config.ts <path-to-test-file>
```

When developing/debugging the test, run fail-fast with no retries:

```bash
npx playwright test --config .ai/qa/playwright.config.ts <path-to-test-file> --retries=0
```

If it fails, fix it. Do not leave broken tests.

### Failure Analysis and User Reporting (Mandatory on Failures)

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

### Running-Only Mode (No New Test Authoring)

If the user asks only to run integration tests (full suite/category/single file), skip authoring phases and execute the requested run directly.
If the run fails, apply the failure-analysis section above.

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

Given a spec for an Inventory Management module, the skill would produce:

- `src/modules/inventory/__integration__/TC-INV-001.spec.ts` — UI: create and list inventory items
- `src/modules/inventory/__integration__/TC-INV-002.spec.ts` — API: CRUD operations on inventory items
- `src/modules/inventory/__integration__/TC-INV-003.spec.ts` — UI: validation errors on create form
- Optionally: matching `.ai/qa/scenarios/TC-INV-001-*.md` files for documentation

## Default Credentials

Created via `yarn initialize`:

| Role | Email | Password |
|------|-------|----------|
| Superadmin | `superadmin@acme.com` | `secret` |
| Admin | `admin@acme.com` | `secret` |
| Employee | `employee@acme.com` | `secret` |

Overridable via env: `OM_INIT_SUPERADMIN_EMAIL`, `OM_INIT_SUPERADMIN_PASSWORD`

## Rules

- MUST explore the running app before writing — never guess selectors or flows
- MUST verify the dev server is running before executing tests
- MUST NOT hardcode record IDs (UUIDs/PKs) in generated tests
- MUST discover or create test entities at runtime, then navigate using discovered links/URLs
- MUST NOT rely on seeded/demo data for prerequisites
- MUST create required fixtures per test (prefer API fixture setup for stability)
- MUST clean up any data created by the test in `finally`/teardown
- MUST keep tests deterministic and isolated from run order or retries
- MUST NOT add per-test timeout/retry overrides in `.spec.ts`; rely on global Playwright config (`timeout: 20s`, `expect.timeout: 20s`, `retries: 1`)
- MUST create the `.spec.ts` — the markdown scenario is optional
- MUST use actual locators from Playwright MCP snapshots (`getByRole`, `getByLabel`, `getByText`)
- MUST verify the test passes before finishing
- MUST analyze failed test artifacts (`stdout`, `error-context.md`, screenshots/report) before reporting failures
- MUST report failures in a per-test table that includes reason, evidence, and suggested owner
- MUST place new tests in module-local `__integration__` directories under `src/modules/`
- MUST use `meta.ts` dependency metadata for module-gated folders and per-test `.meta.ts` for individual gating
- When deriving from a spec, focus on the happy path first, then add edge cases as separate test cases
- Each test file covers one scenario — create multiple files for multiple scenarios
