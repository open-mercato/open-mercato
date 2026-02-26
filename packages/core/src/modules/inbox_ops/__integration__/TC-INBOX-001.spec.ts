import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { submitTextExtraction, deleteInboxEmail } from '@open-mercato/core/modules/core/__integration__/helpers/inboxFixtures';

test.describe('TC-INBOX-001: Inbox Ops Proposals UI', () => {
  let token: string;
  const createdEmailIds: string[] = [];

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin');

    const result = await submitTextExtraction(request, token, {
      text: 'Hello, I am Jane Smith <jane@testfixture.com>. Please send me a quote for 3x Premium Widget at $50 each.',
      title: 'TC-INBOX-001 fixture email',
    });
    if (result.emailId) createdEmailIds.push(result.emailId);
  });

  test.afterAll(async ({ request }) => {
    for (const emailId of createdEmailIds) {
      await deleteInboxEmail(request, token, emailId);
    }
  });

  test.describe('Proposals List Page', () => {
    test.beforeEach(async ({ page }) => {
      await login(page, 'admin');
    });

    test('renders standard DataTable with title and filters', async ({ page }) => {
      await page.goto('/backend/inbox-ops');

      await expect(page.getByRole('heading', { name: /AI Inbox Actions/i })).toBeVisible();

      await expect(page.getByRole('link', { name: /Settings/i })).toBeVisible();
    });

    test('shows data or empty state', async ({ page }) => {
      await page.goto('/backend/inbox-ops');

      await page.waitForLoadState('networkidle');

      const dataOrEmpty = page.locator('table tbody tr').or(page.getByText(/Forward emails to start/i));
      await expect(dataOrEmpty.first()).toBeVisible();
    });

    test('search input is available', async ({ page }) => {
      await page.goto('/backend/inbox-ops');
      await expect(page.getByPlaceholder(/Search proposals/i)).toBeVisible();
    });
  });

  test.describe('Settings Page', () => {
    test.beforeEach(async ({ page }) => {
      await login(page, 'admin');
    });

    test('settings page loads and shows forwarding address', async ({ page }) => {
      await page.goto('/backend/inbox-ops/settings');
      await expect(page.getByText(/Inbox Settings/i)).toBeVisible();
      await expect(page.getByText(/Forwarding Address/i)).toBeVisible();
    });
  });

  test.describe('API — Proposals List', () => {
    test('GET /api/inbox_ops/proposals returns valid response', async ({ request }) => {
      const response = await apiRequest(request, 'GET', '/api/inbox_ops/proposals?page=1&pageSize=10', { token });
      expect(response.status()).toBe(200);
      const body = await readJsonSafe<{ items: unknown[] }>(response);
      expect(body).toBeDefined();
      expect(body!.items).toBeDefined();
      expect(Array.isArray(body!.items)).toBe(true);
    });

    test('GET /api/inbox_ops/proposals/counts returns status counts', async ({ request }) => {
      const response = await apiRequest(request, 'GET', '/api/inbox_ops/proposals/counts', { token });
      expect(response.status()).toBe(200);
      const body = await readJsonSafe<{ pending: number; partial: number; accepted: number; rejected: number }>(response);
      expect(body).toBeDefined();
      expect(typeof body!.pending).toBe('number');
      expect(typeof body!.partial).toBe('number');
      expect(typeof body!.accepted).toBe('number');
      expect(typeof body!.rejected).toBe('number');
    });

    test('GET /api/inbox_ops/settings returns settings', async ({ request }) => {
      const response = await apiRequest(request, 'GET', '/api/inbox_ops/settings', { token });
      expect(response.status()).toBe(200);
      const body = await readJsonSafe<{ settings: unknown }>(response);
      expect(body).toBeDefined();
      expect(body!.settings).toBeDefined();
    });
  });

  test.describe('Sidebar Navigation', () => {
    test.beforeEach(async ({ page }) => {
      await login(page, 'admin');
    });

    test('sidebar shows AI Inbox Actions group', async ({ page }) => {
      await page.goto('/backend/inbox-ops');
      await expect(page.getByText('AI Inbox Actions')).toBeVisible();
    });
  });
});
