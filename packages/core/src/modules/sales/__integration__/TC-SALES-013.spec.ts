import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

function readId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  for (const key of ['id', 'entityId', 'channelId']) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  for (const nested of Object.values(record)) {
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const candidate = readId(nested);
      if (candidate) return candidate;
    }
  }
  return null;
}

/**
 * TC-SALES-013: Sales Channel Config
 * Source: .ai/qa/scenarios/TC-SALES-013-sales-channel-config.md
 */
test.describe('TC-SALES-013: Sales Channel Config', () => {
  test('should create and update a sales channel in UI', async ({ page, request }) => {
    const base = Date.now();
    const name = `QA Channel ${base}`;
    const updatedName = `QA Channel Updated ${base}`;
    const code = `qa-channel-${base}`;
    let token: string | null = null;
    let channelId: string | null = null;

    try {
      token = await getAuthToken(request);
      await login(page, 'admin');
      await page.goto('/backend/sales/channels');
      await page.getByRole('link', { name: /Add channel/i }).click();

      const createForm = page.locator('form').first();
      await createForm.getByRole('textbox').nth(0).fill(name);
      await createForm.getByRole('textbox').nth(1).fill(code);
      const createResponsePromise = page.waitForResponse(
        (response) => response.request().method() === 'POST' && /\/api\/sales\/channels(?:\?|$)/.test(response.url()),
        { timeout: 10_000 },
      );
      await createForm.getByRole('button', { name: /Create channel|Create/i }).first().click();
      const createResponse = await createResponsePromise;
      expect(createResponse.ok(), `Channel create failed with ${createResponse.status()}`).toBeTruthy();
      const createBody = (await createResponse.json().catch(() => null)) as unknown;
      channelId = readId(createBody);
      expect(channelId, 'Channel id should be present in create response').toBeTruthy();

      await page.goto(`/backend/sales/channels/${channelId}/edit`);
      await expect(page).toHaveURL(/\/backend\/sales\/channels\/[0-9a-f-]{36}\/edit$/i);
      const editForm = page.locator('form').first();
      await editForm.getByRole('textbox').nth(0).fill(updatedName);
      const updateResponsePromise = page.waitForResponse(
        (response) => response.request().method() === 'PUT' && /\/api\/sales\/channels(?:\?|$)/.test(response.url()),
        { timeout: 10_000 },
      );
      await editForm.getByRole('button', { name: /Save changes|Update|Save/i }).first().click();
      const updateResponse = await updateResponsePromise;
      expect(updateResponse.ok(), `Channel update failed with ${updateResponse.status()}`).toBeTruthy();
      await page.goto(`/backend/sales/channels/${channelId}/edit`);
      await expect(editForm.getByRole('textbox').nth(0)).toHaveValue(updatedName);
    } finally {
      if (token && channelId) {
        await apiRequest(request, 'DELETE', `/api/sales/channels?id=${encodeURIComponent(channelId)}`, { token }).catch(() => {});
      }
    }
  });
});
