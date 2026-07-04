# Author a New Integration Test

Generate an executable Playwright test in a module-local `__integration__` directory (for example `src/modules/sales/__integration__/TC-SALES-*.spec.ts`) by exploring the running application. Optionally produce a markdown scenario (`.ai/qa/scenarios/TC-*.md`) for documentation — the scenario is **not required**.

## Phase 1 — Identify What to Test

Determine the feature scope from one of these sources (in priority order):

1. **Spec file**: If a spec is referenced or was just implemented, read it from `.ai/specs/*.md`. Extract testable scenarios (see [`derive-from-spec.md`](derive-from-spec.md)).
2. **User description**: If the user describes a feature ("test the company creation flow"), map it to the relevant module and pages.
3. **Recent changes**: If triggered after implementation, use `git diff` or recent commits to identify changed endpoints, pages, and components.

For each feature, identify:
- Which **category** it belongs to (AUTH, CAT, CRM, SALES, ADMIN, INT, API-*)
- Whether it's a **UI test** or **API test**
- The **priority** (High for CRUD operations, Medium for settings/config, Low for edge cases)
- The **prerequisite role** (superadmin, admin, or employee)

## Phase 2 — Find the Next TC Number

List existing test cases in the target category to determine the next sequential number:

```bash
ls .ai/qa/scenarios/TC-{CATEGORY}-*.md 2>/dev/null | sort | tail -1
find src/modules -type f -name "TC-{CATEGORY}-*.spec.ts" 2>/dev/null | sort | tail -1
```

Use the highest number found across both directories, then increment. For example, if the last scenario is TC-CRM-011 but the last test is TC-CRM-013, use TC-CRM-014.

## Phase 3 — Verify the Dev Server Is Running

Before writing or running tests, ensure the app is running:

1. Check if `yarn dev` is active (the app should be listening on `http://localhost:3000` or the `BASE_URL` configured in `.env`).
2. If not running, tell the user to start it: `yarn dev`.
3. Use the base URL from `.env` or default to `http://localhost:3000`.

## Phase 4 — Explore the Feature via Playwright MCP

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

## Phase 5 — Write the Playwright Test

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

## Phase 6 — Optionally Write the Markdown Scenario

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

## Phase 7 — Verify

Run the new test to confirm it passes:

```bash
npx playwright test --config .ai/qa/tests/playwright.config.ts <path-to-test-file>
```

When developing/debugging the test, run fail-fast with no retries:

```bash
npx playwright test --config .ai/qa/tests/playwright.config.ts <path-to-test-file> --retries=0
```

If it fails, fix it. Do not leave broken tests. On failures, follow the failure-analysis section in [`run-and-diagnose.md`](run-and-diagnose.md).

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
