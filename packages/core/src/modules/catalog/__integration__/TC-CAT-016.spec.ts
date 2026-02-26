import { expect, test } from '@playwright/test';
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-CAT-016: GET /api/catalog/prices/omnibus-preview — disabled returns null; enabled returns block
 * Source: SPEC-033 — Omnibus Price Tracking, Phase 3
 */
test.describe('TC-CAT-016: Omnibus Preview Endpoint', () => {
  test('disabled omnibus returns null; enabled omnibus returns block', async ({ request }) => {
    const stamp = Date.now();
    let token: string | null = null;
    let productId: string | null = null;
    let priceKindId: string | null = null;
    let originalConfig: Record<string, unknown> = {};

    try {
      token = await getAuthToken(request);

      // Save original config for cleanup
      const getConfigRes = await apiRequest(request, 'GET', '/api/catalog/config/omnibus', { token });
      expect(getConfigRes.ok()).toBeTruthy();
      originalConfig = ((await getConfigRes.json()) as Record<string, unknown>) ?? {};

      // Fetch first price kind
      const kindsRes = await apiRequest(request, 'GET', '/api/catalog/price-kinds?pageSize=1', { token });
      expect(kindsRes.ok()).toBeTruthy();
      const kindsBody = (await kindsRes.json()) as { items?: { id: string }[] };
      expect(Array.isArray(kindsBody.items) && kindsBody.items.length > 0).toBeTruthy();
      priceKindId = kindsBody.items![0]!.id;

      // Create a product fixture
      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-016 ${stamp}`,
        sku: `QA-CAT-016-${stamp}`,
      });

      // --- Scenario 1: Omnibus DISABLED → response body is null ---
      await apiRequest(request, 'PATCH', '/api/catalog/config/omnibus', {
        token,
        data: { enabled: false },
      });

      const disabledRes = await apiRequest(
        request,
        'GET',
        `/api/catalog/prices/omnibus-preview?priceKindId=${priceKindId}&currencyCode=USD&productId=${productId}`,
        { token },
      );
      expect(disabledRes.ok()).toBeTruthy();
      const disabledBody = await disabledRes.json();
      expect(disabledBody).toBeNull();

      // --- Scenario 2: Omnibus ENABLED → response is a block object ---
      await apiRequest(request, 'PATCH', '/api/catalog/config/omnibus', {
        token,
        data: { enabled: true, enabledCountryCodes: ['PL'] },
      });

      const enabledRes = await apiRequest(
        request,
        'GET',
        `/api/catalog/prices/omnibus-preview?priceKindId=${priceKindId}&currencyCode=USD&productId=${productId}`,
        { token },
      );
      expect(enabledRes.ok()).toBeTruthy();
      const enabledBody = (await enabledRes.json()) as Record<string, unknown> | null;
      // Block must be non-null and have required fields
      expect(enabledBody).not.toBeNull();
      expect(typeof enabledBody?.applicabilityReason === 'string').toBeTruthy();
      expect(typeof enabledBody?.applicable === 'boolean').toBeTruthy();
      expect(typeof enabledBody?.currencyCode === 'string').toBeTruthy();
      expect(enabledBody?.currencyCode).toBe('USD');

      // --- Scenario 3: Missing required priceKindId → 400 validation error ---
      const missingKindRes = await apiRequest(
        request,
        'GET',
        `/api/catalog/prices/omnibus-preview?currencyCode=USD`,
        { token },
      );
      expect(missingKindRes.status()).toBe(400);
    } finally {
      // Restore config
      if (token) {
        const restore: Record<string, unknown> = {};
        if (originalConfig.enabled !== undefined) restore.enabled = originalConfig.enabled;
        if (originalConfig.enabledCountryCodes !== undefined)
          restore.enabledCountryCodes = originalConfig.enabledCountryCodes;
        if (Object.keys(restore).length > 0) {
          await apiRequest(request, 'PATCH', '/api/catalog/config/omnibus', {
            token,
            data: restore,
          }).catch(() => {});
        }
      }
      await deleteCatalogProductIfExists(request, token, productId);
    }
  });
});
