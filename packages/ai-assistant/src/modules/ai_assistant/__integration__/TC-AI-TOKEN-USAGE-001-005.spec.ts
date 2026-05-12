import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-AI-TOKEN-USAGE-001 through TC-AI-TOKEN-USAGE-005
 *
 * Integration coverage for Phase 6 (Token Usage Tracking & Stats Page) of
 * spec `2026-04-28-ai-agents-agentic-loop-controls`.
 *
 * TC-AI-TOKEN-USAGE-001 — Usage page loads and renders summary tiles (ACL gate).
 * TC-AI-TOKEN-USAGE-002 — Date filter apply re-fetches with updated params.
 * TC-AI-TOKEN-USAGE-003 — Sessions list renders when API returns session rows.
 * TC-AI-TOKEN-USAGE-004 — Clicking a session row opens the detail dialog.
 * TC-AI-TOKEN-USAGE-005 — Unauthenticated visit to usage page redirects to login.
 *
 * All API calls are intercepted via page.route() stubs — no real DB needed.
 */

const USAGE_PAGE = '/backend/config/ai-assistant/usage';

const EMPTY_DAILY_PAYLOAD = { rows: [], total: 0 };
const EMPTY_SESSIONS_PAYLOAD = { sessions: [], total: 0, limit: 50, offset: 0 };

const DAILY_ROW = {
  id: 'row-1',
  tenantId: 'tenant-1',
  organizationId: null,
  day: '2026-05-01',
  agentId: 'catalog.assistant',
  modelId: 'claude-haiku-4-5',
  providerId: 'anthropic',
  inputTokens: '1000',
  outputTokens: '500',
  cachedInputTokens: '0',
  reasoningTokens: '0',
  stepCount: '5',
  turnCount: '3',
  sessionCount: '2',
  createdAt: '2026-05-01T12:00:00.000Z',
  updatedAt: '2026-05-01T12:00:00.000Z',
};

const SESSION_ROW = {
  sessionId: '00000000-0000-0000-0000-000000000001',
  agentId: 'catalog.assistant',
  moduleId: 'catalog',
  userId: 'user-1',
  startedAt: '2026-05-01T10:00:00.000Z',
  lastEventAt: '2026-05-01T10:05:00.000Z',
  stepCount: 5,
  turnCount: 3,
  inputTokens: 1000,
  outputTokens: 500,
  cachedInputTokens: 0,
  reasoningTokens: 0,
};

const STEP_EVENT = {
  id: 'evt-1',
  tenantId: 'tenant-1',
  organizationId: null,
  userId: 'user-1',
  agentId: 'catalog.assistant',
  moduleId: 'catalog',
  sessionId: '00000000-0000-0000-0000-000000000001',
  turnId: '00000000-0000-0000-0000-000000000002',
  stepIndex: 0,
  providerId: 'anthropic',
  modelId: 'claude-haiku-4-5',
  inputTokens: 1000,
  outputTokens: 500,
  cachedInputTokens: null,
  reasoningTokens: null,
  finishReason: 'stop',
  loopAbortReason: null,
  createdAt: '2026-05-01T10:00:00.000Z',
  updatedAt: '2026-05-01T10:00:00.000Z',
};

test.describe('TC-AI-TOKEN-USAGE-001–005: token usage stats page', () => {
  test('TC-AI-TOKEN-USAGE-001: usage page renders summary tiles for superadmin', async ({ page }) => {
    await login(page, 'superadmin');

    await page.route('**/api/ai_assistant/usage/daily**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ rows: [DAILY_ROW], total: 1 }),
      });
    });

    await page.route('**/api/ai_assistant/usage/sessions**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(EMPTY_SESSIONS_PAYLOAD),
      });
    });

    await page.goto(USAGE_PAGE, { waitUntil: 'domcontentloaded' });

    const inputTokensTile = page.getByText('1,000').first();
    const outputTokensTile = page.getByText('500').first();
    await expect(inputTokensTile.or(outputTokensTile)).toBeVisible({ timeout: 15_000 });
  });

  test('TC-AI-TOKEN-USAGE-002: apply filter triggers re-fetch with new date params', async ({ page }) => {
    await login(page, 'superadmin');

    const fetchedUrls: string[] = [];

    await page.route('**/api/ai_assistant/usage/daily**', async (route) => {
      fetchedUrls.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(EMPTY_DAILY_PAYLOAD),
      });
    });

    await page.route('**/api/ai_assistant/usage/sessions**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(EMPTY_SESSIONS_PAYLOAD),
      });
    });

    await page.goto(USAGE_PAGE, { waitUntil: 'domcontentloaded' });

    const fromInput = page.locator('#usage-from');
    const toInput = page.locator('#usage-to');
    const applyButton = page.getByRole('button', { name: /apply/i });

    await expect(fromInput).toBeVisible({ timeout: 10_000 });

    await fromInput.fill('2026-04-01');
    await toInput.fill('2026-04-30');
    await applyButton.click();

    await page.waitForTimeout(500);

    const hasNewDates = fetchedUrls.some((url) => url.includes('from=2026-04-01'));
    expect(hasNewDates).toBe(true);
  });

  test('TC-AI-TOKEN-USAGE-003: sessions list renders rows when API returns sessions', async ({ page }) => {
    await login(page, 'superadmin');

    await page.route('**/api/ai_assistant/usage/daily**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(EMPTY_DAILY_PAYLOAD),
      });
    });

    await page.route('**/api/ai_assistant/usage/sessions**', async (route, request) => {
      if (request.url().includes('/sessions/')) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessions: [SESSION_ROW], total: 1, limit: 50, offset: 0 }),
      });
    });

    await page.goto(USAGE_PAGE, { waitUntil: 'domcontentloaded' });

    const sessionCell = page.getByText('00000000').first();
    await expect(sessionCell).toBeVisible({ timeout: 15_000 });
  });

  test('TC-AI-TOKEN-USAGE-004: clicking a session row opens the detail dialog', async ({ page }) => {
    await login(page, 'superadmin');

    await page.route('**/api/ai_assistant/usage/daily**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(EMPTY_DAILY_PAYLOAD),
      });
    });

    await page.route('**/api/ai_assistant/usage/sessions/00000000-0000-0000-0000-000000000001', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ events: [STEP_EVENT], total: 1, sessionId: SESSION_ROW.sessionId }),
      });
    });

    await page.route('**/api/ai_assistant/usage/sessions**', async (route, request) => {
      if (request.url().includes('/00000000-0000-0000-0000-000000000001')) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessions: [SESSION_ROW], total: 1, limit: 50, offset: 0 }),
      });
    });

    await page.goto(USAGE_PAGE, { waitUntil: 'domcontentloaded' });

    const sessionCell = page.getByText('00000000').first();
    await expect(sessionCell).toBeVisible({ timeout: 15_000 });
    await sessionCell.click();

    const dialogTitle = page.getByRole('dialog');
    await expect(dialogTitle).toBeVisible({ timeout: 10_000 });

    const modelCell = page.getByText('claude-haiku-4-5').first();
    await expect(modelCell).toBeVisible({ timeout: 5_000 });
  });

  test('TC-AI-TOKEN-USAGE-005: unauthenticated visit redirects to login', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(USAGE_PAGE, { waitUntil: 'domcontentloaded' });
      await page.waitForURL(/\/login/, { timeout: 15_000 });
      expect(page.url()).toMatch(/\/login/);
    } finally {
      await context.close();
    }
  });
});
