# QA Integration Testing Instructions

## Quick Start

```bash
# Run all integration tests headlessly (zero token cost, CI-ready)
yarn test:integration

# Run a specific category
npx playwright test --config .ai/qa/tests/playwright.config.ts auth/

# Run all tests in ephemeral containers (no dev server needed, Docker required)
yarn test:integration:ephemeral

# View HTML report
yarn test:integration:report
```

---

## Directory Structure

```
.ai/qa/
├── AGENTS.md                    # This file
├── scenarios/                   # OPTIONAL — markdown test case descriptions
│   ├── TC-AUTH-001-*.md         #   Human-readable, used as input for test generation
│   ├── TC-CAT-001-*.md         #   NOT required — tests can be generated directly
│   └── ...
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

## Scenarios Are Optional

Markdown test scenarios (`.ai/qa/scenarios/TC-*.md`) are **optional reference material**. Tests can be generated through any of these paths:

| Path | Input | Output |
|------|-------|--------|
| **From spec** | `.ai/specs/SPEC-*.md` | `.spec.ts` directly (no scenario needed) |
| **From scenario** | `.ai/qa/scenarios/TC-*.md` | `.spec.ts` mapped from scenario steps |
| **From description** | Verbal/written feature description | `.spec.ts` directly |
| **From skill** | `/create-qa-scenario` | `.spec.ts` + optional scenario markdown |

---

## Two Testing Modes

### 1. Executable Tests (Playwright TypeScript) — Preferred

Pre-written tests in `.ai/qa/tests/` that run headlessly via `yarn test:integration`. Zero token cost, CI-ready.

```bash
yarn test:integration
```

### 2. Manual AI-Driven Tests (Playwright MCP)

An AI agent reads a scenario or spec and executes it interactively via Playwright MCP. Useful for exploratory testing and for creating new executable tests.

---

## How to Create New Tests

### Option A: Use `/create-qa-scenario` Skill (Recommended)

The skill reads the related spec, explores the running app via Playwright MCP, and produces executable tests automatically. It optionally generates a markdown scenario for documentation.

```
/create-qa-scenario
```

### Option B: Use `/run-integration-tests` Skill

If a markdown scenario already exists, this skill converts it to an executable test.

### Option C: Manual Workflow

#### Step 1 — Understand What to Test

Read one of:
- A spec from `.ai/specs/SPEC-*.md`
- A scenario from `.ai/qa/scenarios/TC-*.md` (if one exists)
- A feature description from the user

#### Step 2 — Explore via Playwright MCP

Walk through the test flow interactively to discover actual selectors:

```
mcp__playwright__browser_navigate({ url: "http://localhost:3000/login" })
mcp__playwright__browser_snapshot()
mcp__playwright__browser_click({ element: "Submit button", ref: "..." })
```

For each test step:
1. Execute the action via Playwright MCP
2. Snapshot to identify actual element locators (roles, labels, text)
3. Verify the expected result matches reality
4. Note the locator strategy that works

#### Step 3 — Write the TypeScript Test

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

#### Step 4 — Verify

Run the test to confirm it passes:

```bash
npx playwright test --config .ai/qa/tests/playwright.config.ts <category>/TC-{CATEGORY}-{XXX}.spec.ts
```

### MUST Rules for Executable Tests

- Use Playwright locators: `getByRole`, `getByLabel`, `getByText`, `getByPlaceholder` — avoid CSS selectors
- If a matching scenario exists, reference it in a comment (e.g., `Source: .ai/qa/scenarios/TC-AUTH-001-*.md`)
- Keep tests independent — each test handles its own login
- Use helpers from `../helpers/auth` and `../helpers/api`
- One `.spec.ts` file per test case
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
