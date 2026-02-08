# QA Integration Testing Instructions

## Quick Start

```bash
# Run all integration tests headlessly (zero token cost, CI-ready)
yarn test:integration

# Run a specific category
npx playwright test --config .ai/qa/tests/playwright.config.ts auth/

# View HTML report
yarn test:integration:report
```

---

## Two Testing Modes

### 1. Executable Tests (Playwright TypeScript) — Preferred

Pre-written tests in `.ai/qa/tests/` that run headlessly via `yarn test:integration`. Zero token cost, CI-ready.

```bash
yarn test:integration
```

### 2. Manual AI-Driven Tests (Playwright MCP)

An AI agent reads a markdown test case and executes it interactively via Playwright MCP. Useful for exploratory testing and for creating new executable tests.

---

## How to Create New QA Scenarios from Scratch

Use the `/create-qa-scenario` skill to auto-generate both a markdown test case and an executable Playwright test in one go. The skill reads the related spec, explores the running app via Playwright MCP, and produces both files automatically.

```
/create-qa-scenario
```

This is the recommended workflow after implementing a spec. It typically produces 3-8 test cases per spec.

---

## How to Create Executable Tests from Existing Markdown TCs

Use the `/run-integration-tests` skill or follow these steps manually:

### Step 1 — Read the Markdown Test Case

Read the source test case from `.ai/qa/TC-{CATEGORY}-{XXX}-*.md`. Understand the prerequisites, steps, and expected results.

If a related spec exists in `.ai/specs/`, read it for additional context on expected behavior.

### Step 2 — Explore via Playwright MCP

Walk through the test scenario interactively to discover actual selectors:

```
mcp__playwright__browser_navigate({ url: "http://localhost:3000/login" })
mcp__playwright__browser_snapshot()
mcp__playwright__browser_click({ element: "Submit button", ref: "..." })
```

For each markdown test step:
1. Execute the action via Playwright MCP
2. Snapshot to identify actual element locators (roles, labels, text)
3. Verify the expected result matches reality
4. Note the locator strategy that works

### Step 3 — Write the TypeScript Test

Create `.ai/qa/tests/<category>/TC-{CATEGORY}-{XXX}.spec.ts`

**Category-to-folder mapping:**

| Category Code | Folder |
|---------------|--------|
| AUTH | `auth/` |
| CAT | `catalog/` |
| CRM | `crm/` |
| SALES | `sales/` |
| ADMIN | `admin/` |
| INT | `integration/` |
| API-* (all) | `api/` |

**UI test template:**

```typescript
import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';

/**
 * TC-{CATEGORY}-{XXX}: {Title}
 * Source: .ai/qa/TC-{CATEGORY}-{XXX}-{slug}.md
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

### Step 4 — Verify

Run the test to confirm it passes:

```bash
npx playwright test --config .ai/qa/tests/playwright.config.ts <category>/TC-{CATEGORY}-{XXX}.spec.ts
```

### MUST Rules for Executable Tests

- Use Playwright locators: `getByRole`, `getByLabel`, `getByText`, `getByPlaceholder` — avoid CSS selectors
- Every test MUST reference its source markdown file in a comment
- Keep tests independent — each test handles its own login
- Use helpers from `../helpers/auth` and `../helpers/api`
- One `.spec.ts` file per markdown test case
- MUST NOT leave broken tests — fix or skip with `test.skip()` and a reason

---

## How to Test Manually (AI-Driven via Playwright MCP)

### UI Testing

Use Playwright MCP to execute UI test scenarios. The browser automation handles navigation, form interactions, and visual verification.

```bash
# Example: Navigate and interact
mcp__playwright__browser_navigate({ url: "http://localhost:3000/backend/login" })
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
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@acme.com", "password": "secret"}'

# Authenticated request
curl -X GET http://localhost:3000/api/customers/companies \
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

## Directory Structure

```
.ai/qa/
├── AGENTS.md                    # This file
├── TC-AUTH-001-*.md             # Markdown test case descriptions
├── TC-AUTH-002-*.md
├── ...
├── tests/                       # Executable Playwright tests
│   ├── playwright.config.ts
│   ├── .gitignore               # Ignores test-results/
│   ├── helpers/
│   │   ├── auth.ts              # Login helper
│   │   └── api.ts               # API call helper
│   ├── auth/                    # AUTH category tests
│   ├── catalog/                 # CAT category tests
│   ├── crm/                     # CRM category tests
│   ├── sales/                   # SALES category tests
│   ├── admin/                   # ADMIN category tests
│   ├── api/                     # API-* category tests
│   └── integration/             # INT category tests
```

---

## How to Update Test Cases

1. **Locate the test file** in `.ai/qa/` directory
2. **Edit the relevant sections**:
   - Update test steps if flow changed
   - Modify expected results if behavior changed
   - Add new edge cases as discovered
3. **Update the executable test** in `.ai/qa/tests/` if one exists
4. **Maintain consistency**:
   - Keep the same markdown structure
   - Update the test scenario number if title changes significantly
   - Ensure prerequisites are still accurate
5. **Version control**: Commit changes with descriptive message

---

## How to Create New Test Cases

### Naming Convention

```
TC-[CATEGORY]-[XXX]-[title].md
```

- **TC**: Test Case prefix
- **CATEGORY**: Module category code (see below)
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

### Template Structure

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

## Request Body (for API tests, if applicable)
```json
{
  "field": "value"
}
```

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | [Action] | [Expected] |
| 2 | [Action] | [Expected] |

## Expected Response (for API tests)
```json
{
  "success": true
}
```

## Expected Results
- [Final expected outcome 1]
- [Final expected outcome 2]

## Edge Cases / Error Scenarios
- [Edge case 1]
- [Edge case 2]
```

### After Creating a Markdown Test Case

**MUST** also create the corresponding executable Playwright test in `.ai/qa/tests/<category>/TC-{CATEGORY}-{XXX}.spec.ts`. Follow the workflow in "How to Create New Executable Tests" above.

### Best Practices

1. **One scenario per file**: Keep tests atomic and focused
2. **Clear prerequisites**: List all setup requirements
3. **Specific steps**: Each step should be actionable
4. **Measurable results**: Expected results should be verifiable
5. **Include edge cases**: Document error scenarios and boundary conditions
6. **Set priority**: High for critical paths, Medium for standard flows, Low for edge cases
7. **Always create executable test**: Every markdown TC should have a matching `.spec.ts`
