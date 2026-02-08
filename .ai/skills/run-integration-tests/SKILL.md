---
name: run-integration-tests
description: Run and create integration tests for the application. Use when the user wants to execute existing markdown test cases (.ai/qa/TC-*.md) via Playwright, convert them to TypeScript, or run the full integration test suite. Triggers on phrases like "run integration tests", "test this feature", "create test for", "convert test case", "run QA tests", "integration test".
---

# Integration Test Runner

This skill guides you through running integration tests and converting markdown test cases into executable Playwright TypeScript tests.

## Quick Reference

| Action | Command |
|--------|---------|
| Run all tests | `yarn test:integration` |
| Run single test | `npx playwright test --config .ai/qa/tests/playwright.config.ts <path>` |
| View report | `yarn test:integration:report` |
| Test files location | `.ai/qa/tests/<category>/TC-XXX.spec.ts` |
| Markdown sources | `.ai/qa/TC-XXX-*.md` |

## Workflow: Create a New Integration Test

### Phase 1 — Read the Spec

1. Read the markdown test case from `.ai/qa/TC-{CATEGORY}-{XXX}-*.md`
2. If a related spec exists in `.ai/specs/`, read it for context on expected behavior
3. Identify whether this is a **UI test** (uses browser) or **API test** (uses HTTP requests)

### Phase 2 — Explore via Playwright MCP

Use Playwright MCP to walk through the test scenario interactively:

```
mcp__playwright__browser_navigate({ url: "http://localhost:3000/login" })
mcp__playwright__browser_snapshot()
mcp__playwright__browser_click({ element: "...", ref: "..." })
```

For each test step from the markdown:
1. Execute the action via Playwright MCP
2. Take a snapshot to identify actual element selectors (roles, labels, text)
3. Verify the expected result matches reality
4. Note the exact locator strategy that works

### Phase 3 — Write TypeScript Test

Create the test file at `.ai/qa/tests/<category>/TC-{CATEGORY}-{XXX}.spec.ts`

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
 * Source: .ai/qa/TC-{CATEGORY}-{XXX}-{slug}.md
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
 * Source: .ai/qa/TC-{CATEGORY}-{XXX}-{slug}.md
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
- Every test MUST reference its source markdown in a comment
- Keep tests independent — each test should handle its own login
- Use helpers from `../helpers/auth` and `../helpers/api`
- One `.spec.ts` per markdown test case
- Run `yarn test:integration` after adding new tests to confirm nothing broke

## Running All Tests

```bash
# Run all integration tests headlessly (zero token cost)
yarn test:integration

# Run a specific category
npx playwright test --config .ai/qa/tests/playwright.config.ts auth/

# View HTML report after run
yarn test:integration:report
```

## Batch Conversion

When converting multiple test cases at once:

1. List all unconverted markdown TCs: check `.ai/qa/` vs `.ai/qa/tests/`
2. Convert them one category at a time
3. Run the full suite after each category to catch cross-test issues
4. Report summary: total converted, passed, failed
