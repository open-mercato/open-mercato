# QA Integration Testing Instructions

## Quick Start

```bash
# Run all integration tests headlessly (zero token cost, CI-ready)
yarn test:integration

# Run tests matching a module/category path fragment
npx playwright test --config .ai/qa/tests/playwright.config.ts sales

# Run all tests in ephemeral containers (no dev server needed, Docker required)
yarn test:integration:ephemeral

# Run tests from an interactive menu in persisted ephemeral environment
yarn test:integration:ephemeral:interactive

# Start isolated ephemeral app only (for MCP/manual exploration)
yarn test:integration:ephemeral:start

# View HTML report
yarn test:integration:report
```

Preferred local workflow for short iterations:
1. Start `yarn test:integration:ephemeral:start`
2. Reuse the running environment from `.ai/qa/ephemeral-env.json`
3. Use `/integration-tests` against that URL

---

## Directory Structure

```
.ai/qa/
├── AGENTS.md                    # This file
├── scenarios/                   # OPTIONAL — markdown test case descriptions
│   ├── TC-AUTH-001-*.md         #   Human-readable, used as input for test generation
│   ├── TC-CAT-001-*.md         #   NOT required — tests can be generated directly
│   └── ...
├── tests/                       # Playwright config/helpers + legacy test location
│   ├── playwright.config.ts
│   ├── .gitignore               # Ignores test-results/
│   ├── helpers/
│   │   ├── auth.ts              # Login helper
│   │   └── api.ts               # API call helper
└── ...

packages/<package>/src/modules/<module>/__integration__/   # Preferred test location
apps/mercato/src/modules/<module>/__integration__/         # App-specific modules
packages/enterprise/modules/<module>/__integration__/      # Optional enterprise overlay tests
```

---

## Reusable Helpers

Use shared helpers directly from `@open-mercato/core/modules/core/__integration__/helpers/*` instead of creating module-local re-export wrappers.

| Helper Import | Main Exports | Typical Use |
|------|-------|--------|
| `@open-mercato/core/modules/core/__integration__/helpers/auth` | `login`, `DEFAULT_CREDENTIALS` | UI authentication and role-based login (`admin`, `employee`, `superadmin`) |
| `@open-mercato/core/modules/core/__integration__/helpers/api` | `getAuthToken`, `apiRequest` | Authenticated API setup and raw API calls in integration tests |
| `@open-mercato/core/modules/core/__integration__/helpers/authUi` | `createUserViaUi` | Auth module UI flows for user creation/edit smoke coverage |
| `@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures` | `createProductFixture`, `deleteCatalogProductIfExists` | Catalog fixture lifecycle for setup/cleanup |
| `@open-mercato/core/modules/core/__integration__/helpers/crmFixtures` | `createCompanyFixture`, `createPersonFixture`, `createDealFixture`, `deleteEntityIfExists`, `readJsonSafe` | Customers/CRM fixture creation and cleanup; `readJsonSafe` for parsing Playwright APIResponse body to JSON |
| `@open-mercato/core/modules/core/__integration__/helpers/salesFixtures` | `createSalesQuoteFixture`, `createSalesOrderFixture`, `createOrderLineFixture`, `deleteSalesEntityIfExists` | Sales API fixture lifecycle |
| `@open-mercato/core/modules/core/__integration__/helpers/salesUi` | `createSalesDocument`, `addCustomLine`, `updateLineQuantity`, `deleteLine`, `addAdjustment`, `addPayment`, `addShipment`, `readGrandTotalGross` | Sales document UI interactions and totals assertions |
| `packages/create-app/template/src/modules/auth/__integration__/helpers/auth.ts` | `login` | Template-local helper for generated apps (kept local to template) |

Import pattern from module tests:

```ts
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
```

---

## Scenarios Are Optional

Markdown test scenarios (`.ai/qa/scenarios/TC-*.md`) are **optional reference material**. Tests can be generated through any of these paths:

| Path | Input | Output |
|------|-------|--------|
| **From spec** | `.ai/specs/SPEC-*.md` | `.spec.ts` directly (no scenario needed) |
| **From scenario** | `.ai/qa/scenarios/TC-*.md` | `.spec.ts` mapped from scenario steps |
| **From description** | Verbal/written feature description | `.spec.ts` directly |
| **From skill** | `/integration-tests` | `.spec.ts` + optional scenario markdown |

---

## Two Testing Modes

### 1. Executable Tests (Playwright TypeScript) — Preferred

Pre-written tests discovered from module `__integration__` folders (with legacy `.ai/qa/tests/` support) run headlessly via `yarn test:integration`. Zero token cost, CI-ready.

```bash
yarn test:integration
```

### 2. Manual AI-Driven Tests (Playwright MCP)

An AI agent reads a scenario or spec and executes it interactively via Playwright MCP. Useful for exploratory testing and for creating new executable tests.

---

## Interactive Ephemeral Runner

Use interactive mode as the default local workflow when you want one ephemeral app/database session and multiple test runs without repeating full bootstrap.

```bash
yarn test:integration:ephemeral:interactive
```

What you can do from the menu:

- Run all tests
- Run one selected `.spec.ts` file
- Refresh the discovered test list
- Open Playwright HTML report
- Quit and clean up the environment

Useful flags:

- `--workers <n>`
- `--retries <n>`
- `--verbose`
- `--screenshots`
- `--no-screenshots`

Environment state:

- Active ephemeral environment is written to `.ai/qa/ephemeral-env.json`
- Default app port is `5001` when available
- If `5001` is busy, a free fallback port is used and written to `.ai/qa/ephemeral-env.json`
- File is cleared automatically when the ephemeral environment is stopped

---

## How to Create New Tests

### Option A: Use `/integration-tests` Skill (Recommended)

The skill reads the related spec, explores the running app via Playwright MCP, and produces executable tests automatically. It optionally generates a markdown scenario for documentation.

```
/integration-tests
```

### Option B: Manual Workflow

#### Step 1 — Understand What to Test

Read one of:
- A spec from `.ai/specs/SPEC-*.md`
- A scenario from `.ai/qa/scenarios/TC-*.md` (if one exists)
- A feature description from the user

#### Step 2 — Explore via Playwright MCP

Always check `.ai/qa/ephemeral-env.json` first and reuse an existing running environment.

If no active environment exists, start interactive mode first:

```bash
yarn test:integration:ephemeral:start
```

Use isolated app mode only for MCP/manual exploration without the menu:

```bash
yarn test:integration:ephemeral:start
```

Use `base_url` from `.ai/qa/ephemeral-env.json` to avoid interference with any other local app instance.

Walk through the test flow interactively to discover actual selectors:

```
mcp__playwright__browser_navigate({ url: "http://127.0.0.1:<ephemeral-port>/login" })
mcp__playwright__browser_snapshot()
mcp__playwright__browser_click({ element: "Submit button", ref: "..." })
```

For each test step:
1. Execute the action via Playwright MCP
2. Snapshot to identify actual element locators (roles, labels, text)
3. Verify the expected result matches reality
4. Note the locator strategy that works

#### Step 3 — Write the TypeScript Test

Create the test in the module where behavior lives:

- `packages/<package>/src/modules/<module>/__integration__/TC-{CATEGORY}-{XXX}.spec.ts`
- `apps/mercato/src/modules/<module>/__integration__/TC-{CATEGORY}-{XXX}.spec.ts`
- `packages/create-app/template/src/modules/<module>/__integration__/TC-{CATEGORY}-{XXX}.spec.ts`
- `packages/enterprise/modules/<module>/__integration__/TC-{CATEGORY}-{XXX}.spec.ts` for overlay tests only
- Nested subfolders inside `__integration__` are supported

**UI test template:**

```typescript
import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

/**
 * TC-{CATEGORY}-{XXX}: {Title}
 * Source: .ai/qa/scenarios/TC-{CATEGORY}-{XXX}-{slug}.md (if exists)
 */
test.describe('TC-{CATEGORY}-{XXX}: {Title}', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin');
  });

  test('should {main scenario}', async ({ page }) => {
    await page.goto('/backend/...');
    await page.getByRole('button', { name: '...' }).click();
    await expect(page.getByText('...')).toBeVisible();
  });
});
```

**API test template:**

```typescript
import { test, expect } from '@playwright/test';
import { getAuthToken, apiRequest } from './helpers/api';

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

#### Step 4 — Verify

Run the test to confirm it passes:

```bash
npx playwright test --config .ai/qa/tests/playwright.config.ts <path-to-test-file>
```

### Conditional Metadata (Folder + Test)

Use optional metadata to skip tests when required modules are not enabled.

- Folder-level metadata:
  - Add `meta.ts` or `index.ts` under any `__integration__/` subfolder
  - Supported keys: `dependsOnModules`, `requiredModules`, `requiresModules`
- Per-test metadata:
  - Add the same keys inside the `.spec.ts` file, or create sibling `TC-*.meta.ts`
- Inheritance:
  - Metadata is inherited from `__integration__/` root through nested subfolders, then test-level metadata is applied
- Behavior:
  - If any declared dependency module is not enabled, that folder/test is excluded from discovery and run

Example folder metadata:

```ts
export const integrationMeta = {
  description: 'Sales flows requiring currencies module',
  dependsOnModules: ['sales', 'currencies'],
}
```

### MUST Rules for Executable Tests

- Use Playwright locators: `getByRole`, `getByLabel`, `getByText`, `getByPlaceholder` — avoid CSS selectors
- If a matching scenario exists, reference it in a comment (e.g., `Source: .ai/qa/scenarios/TC-AUTH-001-*.md`)
- Keep tests independent — each test handles its own login
- Keep tests data-independent — do not rely on seeded/demo records being present
- Create required fixtures per test (prefer API setup), and always clean up created data in `finally`/teardown
- Ensure tests are deterministic/stable across retries and run order (no cross-test state coupling)
- Keep reusable helpers centralized (recommended: `packages/core/src/modules/core/__integration__/helpers/`), and re-export from module-local helper files when needed
- One `.spec.ts` file per test case
- MUST NOT leave broken tests — fix or skip with `test.skip()` and a reason

---

## How to Test Manually (AI-Driven via Playwright MCP)

### UI Testing

Use Playwright MCP to execute UI test scenarios. The browser automation handles navigation, form interactions, and visual verification.

```bash
# Example: Navigate and interact
mcp__playwright__browser_navigate({ url: "http://127.0.0.1:<ephemeral-port>/backend/login" })
mcp__playwright__browser_snapshot()
mcp__playwright__browser_fill_form({ fields: [...] })
mcp__playwright__browser_click({ element: "Submit button", ref: "..." })
```

**Workflow:**
1. Navigate to the target URL
2. Take a snapshot to identify element refs
3. Interact with elements (click, type, fill forms)
4. Verify expected results via snapshots or assertions

### API Testing (cURL)

Use cURL for direct API endpoint testing.

```bash
# Login and get token
curl -X POST http://127.0.0.1:<ephemeral-port>/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@acme.com", "password": "secret"}'

# Authenticated request
curl -X GET http://127.0.0.1:<ephemeral-port>/api/customers/companies \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json"
```

---

## Default Credentials

These accounts are created via `mercato init` command:

| Role | Email | Password |
|------|-------|----------|
| Superadmin | `superadmin@acme.com` | `secret` |
| Admin | `admin@acme.com` | `secret` |
| Employee | `employee@acme.com` | `secret` |

**Note:** Superadmin has access to all features across all tenants. Admin has full access within their organization. Employee has limited access based on role configuration.

---

## Results Presentation

### For `yarn test:integration` (Headless)

Results are automatically generated:
- **Console**: Pass/fail summary with list reporter
- **JSON**: `test-results/results.json` — machine-readable for CI
- **HTML**: `test-results/html/` — interactive report (open with `yarn test:integration:report`)

### For AI-Driven Tests (Manual)

Present test results in a table format:

#### Test Run Summary

| Test ID | Test Name | Status | Notes |
|---------|-----------|--------|-------|
| TC-AUTH-001 | User Login Success | PASS | |
| TC-AUTH-002 | Invalid Credentials | PASS | |
| TC-AUTH-003 | Remember Me | FAIL | Session not persisted |
| TC-CAT-001 | Product Creation | PASS | |

#### Summary Statistics

| Metric | Count |
|--------|-------|
| Total Tests | X |
| Passed | X |
| Failed | X |
| Skipped | X |
| Pass Rate | X% |

#### Failed Tests Detail

For each failed test, include:
- **Test ID**: TC-XXX-XXX
- **Failure Step**: Step number where failure occurred
- **Expected**: What should have happened
- **Actual**: What actually happened
- **Screenshot/Evidence**: If applicable

---

## How to Manage Scenarios (Optional)

Scenarios live in `.ai/qa/scenarios/` and serve as documentation. They are NOT required for test generation.

### Naming Convention

```
TC-[CATEGORY]-[XXX]-[title].md
```

- **TC**: Test Case prefix
- **CATEGORY**: Module category code (see category codes below)
- **XXX**: 3-digit sequential number
- **title**: Kebab-case descriptive title

### Category Codes

| Code | Category |
|------|----------|
| AUTH | Authentication & User Management |
| CAT | Catalog Management |
| SALES | Sales Management |
| CRM | Customer/CRM Management |
| ADMIN | System Administration |
| INT | Integration Scenarios |
| TRANS | Translations & Localisation |
| AUD | Audit Logs |
| CUR | Currencies & Exchange Rates |
| STAFF | Staff & Team Management |
| DICT | Dictionaries |
| DIR | Directory (Organisations & Tenants) |
| API-SYS | System & Maintenance APIs |
| API-ENT | Custom Fields & Entities APIs |
| API-BULK | Bulk Operations APIs |
| API-AUD | Audit & Business Rules APIs |
| API-SEARCH | Search & Lookup APIs |
| API-FT | Feature Toggles APIs |
| API-VIEW | Perspectives & Views APIs |
| API-ONBOARD | Onboarding APIs |
| API-AUTH | API Authentication & Security |
| API-ERR | API Error Handling & Edge Cases |
| API-DASH | Dashboard & Widget APIs |
| API-DOCS | OpenAPI & Documentation APIs |

### Scenario Template

```markdown
# Test Scenario [NUMBER]: [TITLE]

## Test ID
TC-[CATEGORY]-[XXX]

## Category
[Category Name]

## Priority
[High/Medium/Low]

## Type
[UI Test / API Test]

## Description
[Brief description of what this test validates]

## Prerequisites
- [Prerequisite 1]
- [Prerequisite 2]

## API Endpoint (for API tests)
`[METHOD] /api/path`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | [Action] | [Expected] |
| 2 | [Action] | [Expected] |

## Expected Results
- [Final expected outcome 1]
- [Final expected outcome 2]

## Edge Cases / Error Scenarios
- [Edge case 1]
- [Edge case 2]
```

### Best Practices

1. **One scenario per file**: Keep tests atomic and focused
2. **Clear prerequisites**: List all setup requirements
3. **Specific steps**: Each step should be actionable
4. **Measurable results**: Expected results should be verifiable
5. **Include edge cases**: Document error scenarios and boundary conditions
6. **Set priority**: High for critical paths, Medium for standard flows, Low for edge cases
