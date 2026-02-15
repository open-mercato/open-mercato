---
name: integration-tests
description: Run and create QA integration tests (Playwright TypeScript), including executing the full suite, converting optional markdown scenarios, and generating new tests from specs or feature descriptions. Use when the user says "run integration tests", "test this feature", "create test for", "convert test case", "run QA tests", or "integration test".
---

# Integration Tests Skill

This skill generates executable Playwright tests (`.ai/qa/tests/<category>/TC-*.spec.ts`) by exploring the running application. It optionally produces a markdown scenario (`.ai/qa/scenarios/TC-*.md`) for documentation — the scenario is **not required**.

## Quick Reference

| Action | Command |
|--------|---------|
| Run all tests | `yarn test:integration` |
| Run single test | `npx playwright test --config .ai/qa/tests/playwright.config.ts <path>` |
| Run in ephemeral containers | `yarn test:integration:ephemeral` |
| Run interactive ephemeral mode | `yarn test:integration:ephemeral:interactive` |
| Start ephemeral app only (for MCP exploration, tests development, and debugging) | `yarn test:integration:ephemeral:start` |
| View report | `yarn test:integration:report` |
| Test files location | `.ai/qa/tests/<category>/TC-XXX.spec.ts` |
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
ls .ai/qa/tests/<category>/TC-{CATEGORY}-*.spec.ts 2>/dev/null | sort | tail -1
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

Create `.ai/qa/tests/<category>/TC-{CATEGORY}-{XXX}.spec.ts`

Use the locators discovered in Phase 3 (not guessed). If a scenario was written, reference it in a comment.
Do not hardcode entity IDs in routes, payloads, or assertions. Resolve entities dynamically at runtime by creating fixtures through API/UI steps or by selecting existing rows via stable UI text/role locators.

Category-to-folder mapping:

| Category | Folder |
|----------|--------|
| AUTH | `auth/` |
| CAT | `catalog/` |
| CRM | `crm/` |
| SALES | `sales/` |
| ADMIN | `admin/` |
| INT | `integration/` |
| API-* | `api/` |

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
npx playwright test --config .ai/qa/tests/playwright.config.ts <category>/TC-{CATEGORY}-{XXX}.spec.ts
```

When developing/debugging the test, run fail-fast with no retries:

```bash
npx playwright test --config .ai/qa/tests/playwright.config.ts <category>/TC-{CATEGORY}-{XXX}.spec.ts --retries=0
```

If it fails, fix it. Do not leave broken tests.

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

- `tests/admin/TC-ADMIN-011.spec.ts` — UI: open history panel on an entity
- `tests/api/TC-API-AUD-007.spec.ts` — API: fetch audit logs for entity
- `tests/admin/TC-ADMIN-012.spec.ts` — UI: restore a previous version
- Optionally: matching `.ai/qa/scenarios/TC-ADMIN-011-*.md` files for documentation

## Running Existing Tests

```bash
# Run all integration tests headlessly (zero token cost)
yarn test:integration

# Run a specific category
npx playwright test --config .ai/qa/tests/playwright.config.ts auth/

# Run a single test
npx playwright test --config .ai/qa/tests/playwright.config.ts .ai/qa/tests/auth/TC-AUTH-001.spec.ts

# Run fail-fast in local debugging
npx playwright test --config .ai/qa/tests/playwright.config.ts .ai/qa/tests/auth/TC-AUTH-001.spec.ts --retries=0

# Run in ephemeral containers (Docker required)
yarn test:integration:ephemeral

# Preferred for short local loops (reused ephemeral app + DB)
yarn test:integration:ephemeral:interactive
```

## Batch Conversion

When converting multiple scenarios at once:

1. List unconverted scenarios by comparing `.ai/qa/scenarios/` vs `.ai/qa/tests/`
2. Convert one category at a time
3. Run the full suite after each category to catch cross-test issues
4. Report summary: total converted, passed, failed
