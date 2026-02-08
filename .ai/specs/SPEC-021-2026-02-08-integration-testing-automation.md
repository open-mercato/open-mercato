# SPEC-021: Integration Testing Automation

**Date:** 2026-02-08
**Status:** Draft
**Module:** QA infrastructure (`.ai/qa/`)
**Related:** Scenarios in `.ai/qa/scenarios/TC-*.md`, tests in `.ai/qa/tests/`

---

## Overview

Add a complete integration testing pipeline with two implementation phases:

**Phase 1 — Playwright Test Infrastructure** (current)
1. **Default Playwright + MCP configuration** so Claude Code and Codex agents can run browser tests out of the box
2. **An AI skill** (`/run-integration-tests`) that lets an agent execute test cases via Playwright MCP, then auto-generate TypeScript code from the session
3. **An AI skill** (`/create-qa-scenario`) that auto-generates new QA test cases by reading a spec and exploring the running app via Playwright MCP
4. **Clear instructions** in `.ai/qa/AGENTS.md` for agents to write executable tests
5. **A CLI runner** (`yarn test:integration`) that executes all TypeScript tests headlessly and produces a summary report — zero token cost, suitable for CI

**Phase 2 — Testcontainers Ephemeral Environment**
6. **A CLI command** (`yarn test:integration:ephemeral`) that uses Testcontainers to spin up the full OpenMercato stack (Postgres, app, dependencies) in disposable Docker containers, run migrations, seed data, execute all tests, and tear down — fully self-contained, no pre-existing environment needed

### Why

- Markdown test scenarios are human-readable but not executable — regressions require manual re-testing via AI agents (expensive in tokens)
- A one-time agent session converts each scenario into a reusable Playwright script
- CI can then run all scripts headlessly with zero AI cost, catching regressions automatically
- Testcontainers eliminate the need for a pre-configured environment — tests run anywhere Docker is available

### Scenarios Are Optional

Markdown test scenarios (`.ai/qa/scenarios/TC-*.md`) are **optional reference material**. They serve as human-readable documentation and input for AI-assisted test generation, but tests can be generated directly without them:

- **With scenario**: Agent reads the markdown TC, then generates `.spec.ts` from it
- **Without scenario**: Agent reads the spec (`.ai/specs/SPEC-*.md`) or receives a feature description, explores the running app via Playwright MCP, and generates `.spec.ts` directly
- **Scenario output**: The `/create-qa-scenario` skill can optionally produce a markdown scenario alongside the test, but this is not required

---

## Architecture

```
.ai/qa/
├── AGENTS.md                    # Instructions for agents
├── scenarios/                   # OPTIONAL — markdown test case descriptions
│   ├── TC-AUTH-001-*.md
│   ├── TC-AUTH-002-*.md
│   ├── TC-CAT-001-*.md
│   └── ...
├── tests/                       # Executable Playwright tests
│   ├── playwright.config.ts     # Playwright configuration
│   ├── helpers/
│   │   ├── auth.ts              # Login helper (reusable)
│   │   └── api.ts               # API call helper (reusable)
│   ├── auth/
│   │   ├── TC-AUTH-001.spec.ts  # Matches TC-AUTH-001-*.md (if scenario exists)
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
│   ├── api/
│   │   ├── TC-API-AUTH-001.spec.ts
│   │   └── ...
│   └── integration/
│       └── ...
```

### Flow

```
                      /create-qa-scenario
Spec (SPEC-*.md) ──────────────────────────▶ .spec.ts (+ optional scenario.md) ──▶ CI runs headlessly
                                                   │
                      /run-integration-tests       │ (if scenario exists)
Existing Scenario ─────────────────────────▶ .spec.ts ─────────────────────────┤
                                                                               ▼
                                                         yarn test:integration
                                                    (headless, no tokens, report)
                                                                │
                                              ┌─────────────────┴──────────────────┐
                                              │                                    │
                                    Phase 1: Against         Phase 2: Against
                                    running dev server       ephemeral containers
                                    (yarn test:integration)  (yarn test:integration:ephemeral)
```

---

## Phase 1: Playwright Test Infrastructure

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
 * Source: .ai/qa/scenarios/TC-AUTH-001-user-login-success.md
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
    "test:integration:report": "npx playwright show-report .ai/qa/tests/test-results/html",
    "test:integration:ephemeral": "yarn mercato test:integration"
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

1. Reading a markdown scenario (if one exists) or accepting a feature description
2. Executing it interactively via Playwright MCP to validate it works
3. Converting the session into a TypeScript `.spec.ts` file
4. Saving to `.ai/qa/tests/<category>/TC-XXX.spec.ts`

### 8. AI Skill: `create-qa-scenario`

A new skill at `.ai/skills/create-qa-scenario/SKILL.md` that **automatically generates** new QA tests from scratch. The agent:

1. Reads the related spec (`.ai/specs/SPEC-*.md`) or uses a feature description to identify testable scenarios
2. Finds the next available TC number in the target category
3. Explores the running app via Playwright MCP to discover actual UI elements, form fields, API responses
4. Writes the executable Playwright test (`.ai/qa/tests/<category>/TC-*.spec.ts`) using discovered locators
5. Optionally writes the markdown scenario (`.ai/qa/scenarios/TC-*.md`) for documentation
6. Verifies the test passes headlessly

#### Deriving Tests from Specs

| Spec Section | Generates |
|-------------|-----------|
| API Contracts — each endpoint | One API test per endpoint |
| UI/UX — each user flow | One UI test per flow |
| Edge Cases / Error Scenarios | One test per significant error path |
| Risks & Impact Review | Regression tests for documented failure modes |

A typical spec produces 3-8 test cases.

---

## Phase 2: Testcontainers Ephemeral Environment

### Goal

Provide a single CLI command that spins up the entire OpenMercato stack in disposable Docker containers, runs all integration tests, and tears everything down. No pre-existing database, no running dev server, no manual setup — just `yarn test:integration:ephemeral`.

### Why Testcontainers

- **Isolation**: Each test run gets a fresh Postgres instance, fresh app build — no leftover state between runs
- **Reproducibility**: Identical environment on every developer machine and CI — eliminates "works on my machine"
- **Zero setup**: No need to install/configure Postgres locally, run migrations manually, or start a dev server
- **CI-native**: Docker is available on all major CI runners — no `services:` block configuration needed
- **Parallel-safe**: Multiple developers can run tests simultaneously without port conflicts

### Architecture

```
yarn test:integration:ephemeral
        │
        ▼
┌─────────────────────────────────────────────────────┐
│  Testcontainers Orchestrator (packages/cli)         │
│                                                     │
│  1. Start Postgres container (postgres:16)          │
│  2. Run database migrations (yarn db:migrate)       │
│  3. Seed data (yarn initialize)                     │
│  4. Build & start app in container                  │
│  5. Wait for health check (GET /api/health)         │
│  6. Run Playwright tests against container URL      │
│  7. Collect results & artifacts                     │
│  8. Tear down all containers                        │
└─────────────────────────────────────────────────────┘
        │
        ▼
  Test results (same format as Phase 1)
```

### Implementation

#### CLI Command (`packages/cli`)

Extend the Mercato CLI with a new `test:integration` command:

```bash
yarn mercato test:integration          # Run all tests in ephemeral containers
yarn mercato test:integration --keep   # Keep containers running after tests (for debugging)
yarn mercato test:integration --filter auth/  # Run specific test category
```

#### Container Setup

The orchestrator manages these containers:

| Container | Image | Purpose | Ports |
|-----------|-------|---------|-------|
| `mercato-test-db` | `postgres:16` | Database | Dynamic (mapped via Testcontainers) |
| `mercato-test-app` | Built from repo | App server | Dynamic |

#### Orchestration Script (`packages/cli/src/commands/test-integration.ts`)

Responsibilities:

1. **Start Postgres** via Testcontainers with a random port
2. **Configure environment** — generate `.env.test` with the dynamic Postgres URL
3. **Run migrations** — execute `yarn db:migrate` against the ephemeral DB
4. **Seed data** — execute `yarn initialize` to create default tenant, users, seed data
5. **Start the app** — run `yarn dev` or a production build against the ephemeral DB, wait for health check
6. **Execute tests** — run Playwright with `BASE_URL` pointing to the ephemeral app
7. **Collect artifacts** — copy test results, screenshots, traces to the host
8. **Tear down** — stop and remove all containers (unless `--keep` flag)

#### Health Check

Before running tests, the orchestrator polls the app's health endpoint:

```
GET http://localhost:{dynamic_port}/api/health
```

Retry up to 60 seconds with 1-second intervals. Fail the run if the app doesn't respond.

#### Environment Variables (Ephemeral Mode)

| Variable | Value | Source |
|----------|-------|--------|
| `DATABASE_URL` | `postgres://mercato:secret@localhost:{port}/mercato_test` | Testcontainers dynamic port |
| `BASE_URL` | `http://localhost:{port}` | Testcontainers dynamic port |
| `NODE_ENV` | `test` | Hardcoded |
| `CI` | `true` | Hardcoded |

### Dependencies

Add as dev dependencies (root `package.json`):

```json
{
  "devDependencies": {
    "@playwright/test": "^1.50.0",
    "testcontainers": "^10.0.0"
  }
}
```

Requires Docker to be available on the host machine.

### CI Integration with Testcontainers

With testcontainers the CI workflow becomes much simpler — no `services:` block needed:

```yaml
name: Integration Tests
on:
  schedule:
    - cron: '0 6 * * 1-5'  # weekdays at 6am
  workflow_dispatch:

jobs:
  integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: yarn install
      - run: npx playwright install --with-deps chromium
      - run: yarn test:integration:ephemeral
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: integration-test-results
          path: .ai/qa/tests/test-results/
```

---

## Test File Conventions

### Naming

- File: `TC-{CATEGORY}-{XXX}.spec.ts` — matches the scenario ID (if one exists)
- Folder: category name in lowercase (`auth/`, `catalog/`, `crm/`, `sales/`, `admin/`, `api/`)
- `test.describe` block: `TC-{CATEGORY}-{XXX}: {Title}`

### Category-to-Folder Mapping

| Category | Test Folder |
|----------|-------------|
| AUTH | `auth/` |
| CAT | `catalog/` |
| CRM | `crm/` |
| SALES | `sales/` |
| ADMIN | `admin/` |
| INT | `integration/` |
| API-* (all API categories) | `api/` |

### Structure Rules

- One `.spec.ts` per test case
- Import helpers from `../helpers/auth` and `../helpers/api`
- UI tests use `page` fixture; API tests use `request` fixture
- If a matching scenario exists, reference it in a comment (e.g., `Source: .ai/qa/scenarios/TC-AUTH-001-*.md`)
- Use Playwright locators (`getByRole`, `getByLabel`, `getByText`) — avoid CSS selectors
- Keep tests independent — each test logs in fresh if needed

---

## Workflow: Generating Tests

### Path A: From Spec (No Scenario Needed)

1. Agent reads the spec (`.ai/specs/SPEC-*.md`)
2. Agent explores the running app via Playwright MCP
3. Agent writes `.spec.ts` directly based on real app behavior
4. Agent verifies the test passes headlessly

### Path B: From Existing Scenario

1. Agent reads the scenario from `.ai/qa/scenarios/TC-*.md`
2. Agent explores the running app via Playwright MCP to discover actual selectors
3. Agent writes `.spec.ts` mapping scenario steps to Playwright actions
4. Agent verifies the test passes headlessly

### Path C: From Feature Description

1. Agent receives a verbal or written feature description
2. Agent explores the running app via Playwright MCP
3. Agent writes `.spec.ts` directly
4. Optionally writes a scenario markdown for documentation

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:3000` | App URL for tests |
| `CI` | - | When set, enables stricter timeouts |
| `DATABASE_URL` | - | Overridden automatically in ephemeral mode |

### Dependencies

Add as dev dependencies (root `package.json`):

```json
{
  "devDependencies": {
    "@playwright/test": "^1.50.0",
    "testcontainers": "^10.0.0"
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
- **Severity**: Medium (Phase 1) / Low (Phase 2)
- **Affected area**: Tests fail on fresh environments without seed data
- **Mitigation**: Phase 1: `yarn initialize` must run before tests. Phase 2: Testcontainers automatically seed data — completely eliminates this risk.
- **Residual risk**: If seed data changes, tests may need updates — acceptable, tracked by category

### Port Conflicts

- **Scenario**: `localhost:3000` already in use, tests fail to connect
- **Severity**: Low (Phase 1) / None (Phase 2)
- **Affected area**: Local development
- **Mitigation**: Phase 1: `BASE_URL` env variable allows overriding. Phase 2: Testcontainers use dynamic ports — no conflicts possible.
- **Residual risk**: None in Phase 2

### Token Cost for Test Generation

- **Scenario**: Generating tests via AI agent consumes tokens
- **Severity**: Low
- **Affected area**: One-time cost per test case
- **Mitigation**: Once generated, tests run headlessly with zero token cost. The skill guides efficient generation.
- **Residual risk**: None — by design

### Docker Dependency (Phase 2)

- **Scenario**: Docker not available on developer machine or CI runner
- **Severity**: Medium
- **Affected area**: Phase 2 ephemeral mode only
- **Mitigation**: Phase 1 remains available as fallback (manual dev server). CI runners have Docker pre-installed. Clear error message if Docker is missing.
- **Residual risk**: Developers without Docker can still use Phase 1 workflow

### Container Startup Time (Phase 2)

- **Scenario**: Spinning up Postgres + app containers adds overhead to test runs
- **Severity**: Low
- **Affected area**: Developer experience, CI run time
- **Mitigation**: Postgres container starts in ~2-3 seconds. App startup with build is the bottleneck (~30-60 seconds). `--keep` flag allows reusing containers across debug cycles.
- **Residual risk**: Acceptable — the reliability gains outweigh the overhead

---

## Changelog

### 2026-02-08
- Initial specification
- Added `create-qa-scenario` skill for auto-generating QA tests from specs
- Moved markdown scenarios to `.ai/qa/scenarios/` subfolder (optional reference material)
- Added Phase 2: Testcontainers ephemeral environment for fully self-contained test execution
