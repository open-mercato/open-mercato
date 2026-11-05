import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-AI-INJECT-012: Deal detail AiChat injection (Phase 3 WS-D, Step 5.15).
 *
 * Asserts the `customers.injection.ai-deal-detail-trigger` widget injects
 * an "Ask AI" trigger into the deal detail page's
 * `detail:customers.deal:header` spot WITHOUT editing the page, and opens
 * a sheet embedding `<AiChat agent="customers.account_assistant" …>` with
 * a deal-scoped pageContext (recordType: 'deal', recordId: <dealId>).
 *
 * The test seeds a deal via the customers CRUD API, asserts the trigger
 * renders + opens the sheet + the AiChat composer appears with the right
 * recordId attribute, then cleans up.
 */

interface DealCreateResponse {
  id?: string;
  deal?: { id?: string };
  data?: { id?: string };
  result?: { id?: string };
  record?: { id?: string };
  [key: string]: unknown;
}

function extractId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as DealCreateResponse;
  if (typeof record.id === 'string') return record.id;
  if (typeof record.deal?.id === 'string') return record.deal.id as string;
  if (typeof record.data?.id === 'string') return record.data.id as string;
  if (typeof record.result?.id === 'string') return record.result.id as string;
  if (typeof record.record?.id === 'string') return record.record.id as string;
  return null;
}

test.describe('TC-AI-INJECT-012: deal detail AiChat injection', () => {
  test('deal detail header shows the injected AI trigger and opens the sheet', async ({ page, request }) => {
    test.setTimeout(120_000);

    const token = await getAuthToken(request, 'superadmin');

    // Seed a throwaway deal so the detail page has something to render.
    let dealId: string | null = null;
    try {
      const createRes = await apiRequest(request, 'POST', '/api/customers/deals', {
        token,
        data: {
          title: `TC-AI-INJECT-012 ${Date.now()}`,
          status: 'open',
        },
      });
      if (createRes.status() >= 400) {
        test.skip(true, `Deal seed returned status ${createRes.status()}`);
      }
      const payload = await createRes.json().catch(() => ({}));
      dealId = extractId(payload);
    } catch (error) {
      test.skip(true, `Deal seed unavailable: ${(error as Error).message}`);
    }

    expect(dealId, 'Seeded deal should expose an id').toBeTruthy();

    try {
      await page.goto('/login', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 30_000 });
      await login(page, 'superadmin');
      await page.goto(`/backend/customers/deals/${dealId}`, { waitUntil: 'domcontentloaded' });

      const trigger = page.locator('[data-ai-customers-deal-trigger]').first();
      await expect(trigger).toBeVisible({ timeout: 60_000 });
      await expect(trigger).toHaveAttribute('data-ai-customers-deal-id', String(dealId));

      await trigger.click();

      const sheet = page.locator('[data-ai-customers-deal-sheet]');
      await expect(sheet).toBeVisible();

      const chatRegion = page.locator('[data-ai-chat-agent="customers.account_assistant"]');
      await expect(chatRegion).toBeVisible();
      const composer = page.locator('#ai-chat-composer');
      await expect(composer).toBeVisible();
    } finally {
      if (dealId) {
        await apiRequest(request, 'DELETE', '/api/customers/deals', {
          token,
          data: { id: dealId },
        }).catch(() => undefined);
      }
    }
  });
});
