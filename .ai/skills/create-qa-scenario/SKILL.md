---
name: create-qa-scenario
description: Automatically create a new QA test scenario (markdown + Playwright TypeScript) for a feature or spec. Use when a new feature has been implemented and needs test coverage, after completing a spec implementation, or when the user says "create test for", "add QA scenario", "generate test case", "write integration test for this feature". This skill auto-discovers what to test by reading the related spec and exploring the running app via Playwright MCP.
---

# QA Scenario Creator

This skill generates a complete QA test scenario — both the markdown description (`.ai/qa/TC-*.md`) and the executable Playwright test (`.ai/qa/tests/<category>/TC-*.spec.ts`) — by exploring the running application.

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
ls .ai/qa/TC-{CATEGORY}-*.md | sort | tail -1
```

Use the next available 3-digit number (e.g., if last is TC-CRM-011, use TC-CRM-012).

### Phase 3 — Explore the Feature via Playwright MCP

Navigate to the feature in the running app and discover the actual UI:

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

### Phase 4 — Write the Markdown Test Case

Create `.ai/qa/TC-{CATEGORY}-{XXX}-{slug}.md` using the template:

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

### Phase 5 — Write the Playwright Test

Create `.ai/qa/tests/<category>/TC-{CATEGORY}-{XXX}.spec.ts`

Use the locators discovered in Phase 3 (not guessed). Reference the markdown file in a comment.

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

### Phase 6 — Verify

Run the new test to confirm it passes:

```bash
npx playwright test --config .ai/qa/tests/playwright.config.ts <category>/TC-{CATEGORY}-{XXX}.spec.ts
```

If it fails, fix it. Do not leave broken tests.

## Rules

- MUST explore the running app before writing — never guess selectors or flows
- MUST create both the markdown TC and the `.spec.ts` — never just one
- MUST use actual locators from Playwright MCP snapshots (`getByRole`, `getByLabel`, `getByText`)
- MUST verify the test passes before finishing
- If the app is not running, inform the user and stop — do not write speculative tests
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

- `TC-ADMIN-011-version-history-view.md` + `admin/TC-ADMIN-011.spec.ts` — UI: open history panel on an entity
- `TC-API-AUD-007-version-history-api.md` + `api/TC-API-AUD-007.spec.ts` — API: fetch audit logs for entity
- `TC-ADMIN-012-version-history-restore.md` + `admin/TC-ADMIN-012.spec.ts` — UI: restore a previous version
