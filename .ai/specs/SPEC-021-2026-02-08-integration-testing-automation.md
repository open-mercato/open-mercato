# SPEC-021: Integration Testing Automation

**Date:** 2026-02-08
**Status:** Draft
**Module:** QA infrastructure (`.ai/qa/`)
**Related:** All existing test cases in `.ai/qa/TC-*.md`

---

## Overview

Add a complete integration testing pipeline that bridges the existing markdown test case descriptions (`.ai/qa/TC-*.md`) with executable Playwright TypeScript tests. The system provides:

1. **Default Playwright + MCP configuration** so Claude Code and Codex agents can run browser tests out of the box
2. **An AI skill** (`/run-integration-tests`) that lets an agent execute markdown test cases via Playwright MCP, then auto-generate TypeScript code from the session
3. **Clear instructions** in `.ai/qa/AGENTS.md` for agents to convert markdown specs into executable tests
4. **A CLI runner** (`yarn test:integration`) that executes all TypeScript tests headlessly and produces a summary report — zero token cost, suitable for CI

### Why

- Markdown test cases are human-readable but not executable — regressions require manual re-testing via AI agents (expensive in tokens)
- A one-time agent session converts each markdown test into a reusable Playwright script
- CI can then run all scripts headlessly with zero AI cost, catching regressions automatically

---

## Architecture

```
.ai/qa/
├── AGENTS.md                    # Instructions for agents (updated)
├── TC-AUTH-001-*.md             # Markdown test case descriptions (existing)
├── TC-AUTH-002-*.md
├── ...
├── tests/                       # NEW — executable Playwright tests
│   ├── playwright.config.ts     # Playwright configuration
│   ├── helpers/
│   │   ├── auth.ts              # Login helper (reusable)
│   │   └── api.ts               # API call helper (reusable)
│   ├── auth/
│   │   ├── TC-AUTH-001.spec.ts  # Matches TC-AUTH-001-*.md
│   │   ├── TC-AUTH-002.spec.ts
│   │   └── ...
│   ├── catalog/
│   │   ├── TC-CAT-001.spec.ts
│   │   └── ...
│   ├── crm/
│   │   └── ...
│   ├── sales/
│   │   └── ...
│   ├── admin/
│   │   └── ...
│   └── api/
│       ├── TC-API-AUTH-001.spec.ts
│       └── ...
```

### Flow

```
Markdown TC ──▶ Agent explores via Playwright MCP ──▶ Agent writes .spec.ts ──▶ CI runs headlessly
     │                                                         │
     │         ┌───────────────────────────────────────────────┘
     │         ▼
     └── yarn test:integration  (headless, no tokens, JSON/HTML report)
```

---

## Components

### 1. Playwright Configuration (`.ai/qa/tests/playwright.config.ts`)

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  retries: 1,
  workers: 1, // sequential — tests may share state via login
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/results.json' }],
    ['html', { outputFolder: 'test-results/html', open: 'never' }],
  ],
  outputDir: 'test-results/artifacts',
});
```

### 2. Auth Helper (`.ai/qa/tests/helpers/auth.ts`)

```typescript
import { type Page } from '@playwright/test';

export const DEFAULT_CREDENTIALS = {
  superadmin: { email: 'superadmin@acme.com', password: 'secret' },
  admin: { email: 'admin@acme.com', password: 'secret' },
  employee: { email: 'employee@acme.com', password: 'secret' },
} as const;

export type Role = keyof typeof DEFAULT_CREDENTIALS;

export async function login(page: Page, role: Role = 'admin'): Promise<void> {
  const creds = DEFAULT_CREDENTIALS[role];
  await page.goto('/login');
  await page.getByLabel('Email').fill(creds.email);
  await page.getByLabel('Password').fill(creds.password);
  await page.getByRole('button', { name: /login|sign in/i }).click();
  await page.waitForURL('**/backend/**');
}
```

### 3. API Helper (`.ai/qa/tests/helpers/api.ts`)

```typescript
import { type APIRequestContext } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

export async function getAuthToken(
  request: APIRequestContext,
  email = 'admin@acme.com',
  password = 'secret',
): Promise<string> {
  const response = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { email, password },
  });
  const body = await response.json();
  return body.token;
}

export async function apiRequest(
  request: APIRequestContext,
  method: string,
  path: string,
  options: { token: string; data?: unknown },
) {
  const url = `${BASE_URL}${path}`;
  const headers = {
    Authorization: `Bearer ${options.token}`,
    'Content-Type': 'application/json',
  };
  return request.fetch(url, { method, headers, data: options.data });
}
```

### 4. Example Test (`.ai/qa/tests/auth/TC-AUTH-001.spec.ts`)

```typescript
import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';

/**
 * TC-AUTH-001: Successful User Login
 * Source: .ai/qa/TC-AUTH-001-user-login-success.md
 */
test.describe('TC-AUTH-001: Successful User Login', () => {
  test('should login with valid credentials and redirect to dashboard', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Email')).toBeVisible();

    await page.getByLabel('Email').fill('admin@acme.com');
    await page.getByLabel('Password').fill('secret');
    await page.getByRole('button', { name: /login|sign in/i }).click();

    await page.waitForURL('**/backend/**');
    await expect(page).toHaveURL(/\/backend/);
  });
});
```

### 5. CLI Test Runner

Add to root `package.json`:

```json
{
  "scripts": {
    "test:integration": "npx playwright test --config .ai/qa/tests/playwright.config.ts",
    "test:integration:report": "npx playwright show-report .ai/qa/tests/test-results/html"
  }
}
```

### 6. MCP Configuration for Playwright

Add `.claude/settings.json` entry (project-level) so Claude Code agents have Playwright MCP available by default:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@anthropic/mcp-server-playwright"]
    }
  }
}
```

### 7. AI Skill: `run-integration-tests`

A new skill at `.ai/skills/run-integration-tests/SKILL.md` that guides the agent through:

1. Reading a markdown test case
2. Executing it interactively via Playwright MCP to validate it works
3. Converting the session into a TypeScript `.spec.ts` file
4. Saving to `.ai/qa/tests/<category>/TC-XXX.spec.ts`

---

## Test File Conventions

### Naming

- File: `TC-{CATEGORY}-{XXX}.spec.ts` — matches the markdown test case ID
- Folder: category name in lowercase (`auth/`, `catalog/`, `crm/`, `sales/`, `admin/`, `api/`)
- `test.describe` block: `TC-{CATEGORY}-{XXX}: {Title}`

### Category-to-Folder Mapping

| Markdown Category | Test Folder |
|-------------------|-------------|
| AUTH | `auth/` |
| CAT | `catalog/` |
| CRM | `crm/` |
| SALES | `sales/` |
| ADMIN | `admin/` |
| INT | `integration/` |
| API-* (all API categories) | `api/` |

### Structure Rules

- One `.spec.ts` per markdown test case
- Import helpers from `../helpers/auth` and `../helpers/api`
- UI tests use `page` fixture; API tests use `request` fixture
- Every test MUST reference its source markdown file in a comment
- Use Playwright locators (`getByRole`, `getByLabel`, `getByText`) — avoid CSS selectors
- Keep tests independent — each test logs in fresh if needed

---

## Workflow: Converting Markdown TC to TypeScript

### Step 1: Agent Explores via Playwright MCP

The agent reads the markdown test case, then uses Playwright MCP to walk through the scenario interactively:

```
1. Read .ai/qa/TC-AUTH-001-user-login-success.md
2. Navigate to the app via Playwright MCP
3. Follow the test steps from the markdown
4. Observe actual element selectors, form fields, button labels
5. Note any deviations from the expected behavior
```

### Step 2: Agent Writes TypeScript

Using the observations from step 1, the agent writes a `.spec.ts` file:

- Maps each markdown step to a Playwright action
- Uses resilient locators (role-based, label-based)
- Adds assertions for each "Expected Result" column entry
- Covers edge cases listed in the markdown

### Step 3: Agent Verifies

The agent runs the test headlessly to confirm it passes:

```bash
npx playwright test --config .ai/qa/tests/playwright.config.ts auth/TC-AUTH-001.spec.ts
```

---

## CI Integration

### GitHub Actions Example

```yaml
name: Integration Tests
on:
  schedule:
    - cron: '0 6 * * 1-5'  # weekdays at 6am
  workflow_dispatch:

jobs:
  integration:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: mercato_test
          POSTGRES_USER: mercato
          POSTGRES_PASSWORD: secret
        ports: ['5432:5432']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: yarn install
      - run: npx playwright install --with-deps chromium
      - run: yarn build && yarn db:migrate && yarn initialize
      - run: yarn dev &
      - run: sleep 10 && yarn test:integration
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: integration-test-results
          path: .ai/qa/tests/test-results/
```

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:3000` | App URL for tests |
| `CI` | - | When set, enables stricter timeouts |

### Dependencies

Add as dev dependencies (root `package.json`):

```json
{
  "devDependencies": {
    "@playwright/test": "^1.50.0"
  }
}
```

Install browsers:

```bash
npx playwright install chromium
```

---

## Risks & Impact Review

### Test Flakiness in CI

- **Scenario**: Tests rely on UI state that varies between runs (animations, lazy loading, data seeding order)
- **Severity**: Medium
- **Affected area**: CI pipeline reliability
- **Mitigation**: Use `waitForURL`, `waitForSelector`, explicit assertions instead of timing. Set `retries: 1` in config. Workers set to 1 for sequential execution.
- **Residual risk**: Some flakiness may persist with complex UI flows — acceptable for integration tests

### Data State Dependencies

- **Scenario**: Tests assume specific data exists (e.g., products, customers created by `mercato init`)
- **Severity**: Medium
- **Affected area**: Tests fail on fresh environments without seed data
- **Mitigation**: Document prerequisite: `yarn initialize` must run before tests. Auth helper uses default credentials from seed.
- **Residual risk**: If seed data changes, tests may need updates — acceptable, tracked by category

### Port Conflicts

- **Scenario**: `localhost:3000` already in use, tests fail to connect
- **Severity**: Low
- **Affected area**: Local development
- **Mitigation**: `BASE_URL` env variable allows overriding. CI uses isolated containers.
- **Residual risk**: None — fully mitigated

### Token Cost for Test Generation

- **Scenario**: Generating tests via AI agent consumes tokens
- **Severity**: Low
- **Affected area**: One-time cost per test case
- **Mitigation**: Once generated, tests run headlessly with zero token cost. The skill guides efficient generation.
- **Residual risk**: None — by design

---

## Changelog

### 2026-02-08
- Initial specification
