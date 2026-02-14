---
name: run-integration-tests
description: Run and create integration tests for the application. Use when the user wants to execute existing test scenarios (.ai/qa/scenarios/TC-*.md) via Playwright, convert them to TypeScript, or run the full integration test suite. Triggers on phrases like "run integration tests", "test this feature", "create test for", "convert test case", "run QA tests", "integration test".
---

# Integration Test Runner

This skill guides you through running integration tests and converting test scenarios into executable Playwright TypeScript tests. Scenarios are optional — tests can also be generated directly from specs or feature descriptions.

## Quick Reference

| Action | Command |
|--------|---------|
| Run all tests | `yarn test:integration` |
| Run single test | `npx playwright test --config .ai/qa/tests/playwright.config.ts <path>` |
| Run in ephemeral containers | `yarn test:integration:ephemeral` |
| Start ephemeral app only (for MCP exploration) | `yarn test:integration:ephemeral:start` |
| View report | `yarn test:integration:report` |
| Test files location | `.ai/qa/tests/<category>/TC-XXX.spec.ts` |
| Scenario sources (optional) | `.ai/qa/scenarios/TC-XXX-*.md` |

## Workflow: Create a New Integration Test

### Phase 1 — Read the Source

Read one of these (in priority order):

1. A markdown scenario from `.ai/qa/scenarios/TC-{CATEGORY}-{XXX}-*.md` (if one exists)
2. A spec from `.ai/specs/SPEC-*.md` for context on expected behavior
3. A feature description from the user

Identify whether this is a **UI test** (uses browser) or **API test** (uses HTTP requests).

### Phase 2 — Explore via Playwright MCP

Start an isolated Open Mercato instance first, then use Playwright MCP to walk through the scenario:

```bash
yarn test:integration:ephemeral:start
```

The command prints an ephemeral base URL (`http://127.0.0.1:<port>`). Use that URL for MCP navigation. This avoids interference with any other app instance running on `localhost:3000`.

Use Playwright MCP against the printed URL:

```
mcp__playwright__browser_navigate({ url: "http://127.0.0.1:<ephemeral-port>/login" })
mcp__playwright__browser_snapshot()
mcp__playwright__browser_click({ element: "...", ref: "..." })
```

For each test step:
1. Execute the action via Playwright MCP
2. Take a snapshot to identify actual element selectors (roles, labels, text)
3. Verify the expected result matches reality
4. Note the exact locator strategy that works

### Phase 3 — Write TypeScript Test

Create the test file at `.ai/qa/tests/<category>/TC-{CATEGORY}-{XXX}.spec.ts`
Never hardcode entity IDs in test routes or payloads. Create/fetch entities during test setup or open them from list pages using stable user-facing locators.

**Category-to-folder mapping:**

| Category Code | Folder |
|---------------|--------|
| AUTH | `auth/` |
| CAT | `catalog/` |
| CRM | `crm/` |
| SALES | `sales/` |
| ADMIN | `admin/` |
| INT | `integration/` |
| API-* | `api/` |

**Template for UI tests:**

```typescript
import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';

/**
 * TC-{CATEGORY}-{XXX}: {Title}
 * Source: .ai/qa/scenarios/TC-{CATEGORY}-{XXX}-{slug}.md (if exists)
 */
test.describe('TC-{CATEGORY}-{XXX}: {Title}', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin'); // or 'superadmin' / 'employee'
  });

  test('should {main scenario}', async ({ page }) => {
    // Step 1: Navigate
    await page.goto('/backend/...');

    // Step 2: Interact
    await page.getByRole('button', { name: '...' }).click();

    // Step 3: Assert
    await expect(page.getByText('...')).toBeVisible();
  });
});
```

**Template for API tests:**

```typescript
import { test, expect } from '@playwright/test';
import { getAuthToken, apiRequest } from '../helpers/api';

/**
 * TC-{CATEGORY}-{XXX}: {Title}
 * Source: .ai/qa/scenarios/TC-{CATEGORY}-{XXX}-{slug}.md (if exists)
 */
test.describe('TC-{CATEGORY}-{XXX}: {Title}', () => {
  let token: string;

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request);
  });

  test('should {main scenario}', async ({ request }) => {
    const response = await apiRequest(request, 'GET', '/api/...', { token });
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body).toHaveProperty('...');
  });
});
```

### Phase 4 — Verify

Run the test headlessly to confirm:

```bash
npx playwright test --config .ai/qa/tests/playwright.config.ts <category>/TC-{CATEGORY}-{XXX}.spec.ts
```

If it fails, fix the test and re-run. Do not leave broken tests.

## Rules

- Use Playwright locators: `getByRole`, `getByLabel`, `getByText`, `getByPlaceholder` — avoid CSS selectors
- Never hardcode record IDs (UUIDs/PKs) in generated or converted tests
- Discover entities dynamically (API setup, create flow, or list-row navigation) before detail-page assertions
- If a matching scenario exists, reference it in a comment
- Keep tests independent — each test should handle its own login
- Use helpers from `../helpers/auth` and `../helpers/api`
- One `.spec.ts` per test case
- Run `yarn test:integration` after adding new tests to confirm nothing broke

## Running All Tests

```bash
# Run all integration tests headlessly (zero token cost)
yarn test:integration

# Run a specific category
npx playwright test --config .ai/qa/tests/playwright.config.ts auth/

# Run in ephemeral containers (Docker required, no dev server needed)
yarn test:integration:ephemeral

# Start isolated ephemeral app only (for MCP/manual exploration)
yarn test:integration:ephemeral:start

# View HTML report after run
yarn test:integration:report
```

## Batch Conversion

When converting multiple scenarios at once:

1. List all unconverted scenarios: check `.ai/qa/scenarios/` vs `.ai/qa/tests/`
2. Convert them one category at a time
3. Run the full suite after each category to catch cross-test issues
4. Report summary: total converted, passed, failed
