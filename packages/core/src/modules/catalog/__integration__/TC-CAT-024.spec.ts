import { expect, test } from '@playwright/test';
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-CAT-024: Phase 4 perishable goods — omnibusExempt=true + perishableGoodsRule=exempt → perishable_exempt
 * Source: SPEC-033 — Omnibus Price Tracking, Phase 4
 */
test.describe('TC-CAT-024: Omnibus — perishable goods exempt rule', () => {
  test('omnibusExempt product with perishableGoodsRule=exempt returns perishable_exempt', async ({ request }) => {
    const stamp = Date.now();
    let token: string | null = null;
    let productId: string | null = null;
    let priceId: string | null = null;
    let originalConfig: Record<string, unknown> = {};
    // Must be a valid UUID v4 (Zod v4 enforces version/variant bits)
    const fakeChannelId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee22';

    try {
      token = await getAuthToken(request);

      // Save original config
      const getRes = await apiRequest(request, 'GET', '/api/catalog/config/omnibus', { token });
      expect(getRes.ok()).toBeTruthy();
      originalConfig = ((await getRes.json()) as Record<string, unknown>) ?? {};

      // Get a price kind
      const kindsRes = await apiRequest(request, 'GET', '/api/catalog/price-kinds?pageSize=1', { token });
      expect(kindsRes.ok()).toBeTruthy();
      const kindsBody = (await kindsRes.json()) as { items?: { id: string }[] };
      const priceKindId = kindsBody.items?.[0]?.id;
      expect(typeof priceKindId === 'string').toBeTruthy();

      // Create a product with omnibusExempt=true
      const createProductRes = await apiRequest(request, 'POST', '/api/catalog/products', {
        token,
        data: {
          title: `QA TC-CAT-024 ${stamp}`,
          sku: `QA-CAT-022-${stamp}`,
          omnibusExempt: true,
        },
      });
      expect(createProductRes.ok(), `POST product failed: ${createProductRes.status()}`).toBeTruthy();
      const productBody = (await createProductRes.json()) as { id?: string };
      productId = productBody.id ?? null;
      expect(productId).toBeTruthy();

      // Create a price to generate history
      const createPriceRes = await apiRequest(request, 'POST', '/api/catalog/prices', {
        token,
        data: { productId, priceKindId, currencyCode: 'EUR', unitPriceNet: 5.99 },
      });
      expect(createPriceRes.ok()).toBeTruthy();
      const priceBody = (await createPriceRes.json()) as { id?: string };
      priceId = priceBody.id ?? null;

      // Configure omnibus: enabled, channel with perishableGoodsRule=exempt.
      // backfillCoverage is required for channels whose countryCode is in enabledCountryCodes
      // before the PATCH with enabled:true can succeed (backfill_required_before_enable guard).
      const patchRes = await apiRequest(request, 'PATCH', '/api/catalog/config/omnibus', {
        token,
        data: {
          enabled: true,
          enabledCountryCodes: ['DE'],
          backfillCoverage: {
            [fakeChannelId]: { completedAt: new Date().toISOString(), lookbackDays: 30 },
          },
          channels: {
            [fakeChannelId]: {
              presentedPriceKindId: priceKindId,
              countryCode: 'DE',
              perishableGoodsRule: 'exempt',
            },
          },
        },
      });
      expect(patchRes.ok(), `PATCH omnibus config failed: ${patchRes.status()}`).toBeTruthy();

      // Call omnibus-preview with the exempt channel and productId
      const previewRes = await apiRequest(
        request,
        'GET',
        `/api/catalog/prices/omnibus-preview?priceKindId=${priceKindId}&currencyCode=EUR&productId=${productId}&channelId=${fakeChannelId}`,
        { token },
      );
      expect(previewRes.ok()).toBeTruthy();
      const previewBody = (await previewRes.json()) as Record<string, unknown> | null;

      // With omnibusExempt=true and perishableGoodsRule=exempt, expect perishable_exempt reason
      expect(previewBody).not.toBeNull();
      expect(previewBody?.applicabilityReason).toBe('perishable_exempt');
      expect(previewBody?.applicable).toBe(false);
      expect(previewBody?.lowestPriceNet).toBeNull();
      expect(previewBody?.lowestPriceGross).toBeNull();
    } finally {
      if (token && priceId) {
        await apiRequest(request, 'DELETE', `/api/catalog/prices?id=${encodeURIComponent(priceId)}`, { token }).catch(
          () => {},
        );
      }
      await deleteCatalogProductIfExists(request, token, productId);
      if (token) {
        const existingChannels = (originalConfig.channels as Record<string, unknown>) ?? {};
        const { [fakeChannelId]: _removed, ...rest } = existingChannels;
        const restore: Record<string, unknown> = {};
        if (originalConfig.enabled !== undefined) restore.enabled = originalConfig.enabled;
        if (originalConfig.enabledCountryCodes !== undefined)
          restore.enabledCountryCodes = originalConfig.enabledCountryCodes;
        restore.channels = rest;
        await apiRequest(request, 'PATCH', '/api/catalog/config/omnibus', {
          token,
          data: restore,
        }).catch(() => {});
      }
    }
  });
});
