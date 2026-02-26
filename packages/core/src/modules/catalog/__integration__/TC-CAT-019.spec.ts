import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-CAT-019: not_in_eu_market — channel country code not in enabledCountryCodes
 * Source: SPEC-033 — Omnibus Price Tracking, Phase 2
 */
test.describe('TC-CAT-019: Omnibus — not_in_eu_market reason', () => {
  test('channel with non-EU country returns not_in_eu_market block', async ({ request }) => {
    let token: string | null = null;
    let originalConfig: Record<string, unknown> = {};
    // Use a stable fake channel UUID for this test (must be a valid UUID v4)
    const fakeChannelId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee17';

    try {
      token = await getAuthToken(request);

      // Save original config
      const getRes = await apiRequest(request, 'GET', '/api/catalog/config/omnibus', { token });
      expect(getRes.ok()).toBeTruthy();
      originalConfig = ((await getRes.json()) as Record<string, unknown>) ?? {};

      // Get a valid priceKindId
      const kindsRes = await apiRequest(request, 'GET', '/api/catalog/price-kinds?pageSize=1', { token });
      expect(kindsRes.ok()).toBeTruthy();
      const kindsBody = (await kindsRes.json()) as { items?: { id: string }[] };
      expect(Array.isArray(kindsBody.items) && kindsBody.items.length > 0).toBeTruthy();
      const priceKindId = kindsBody.items![0]!.id;

      // Configure: enabled=true, enabledCountryCodes=['DE'], channel with countryCode='FR'
      const patchRes = await apiRequest(request, 'PATCH', '/api/catalog/config/omnibus', {
        token,
        data: {
          enabled: true,
          enabledCountryCodes: ['DE'],
          channels: {
            [fakeChannelId]: {
              presentedPriceKindId: priceKindId,
              countryCode: 'FR',
            },
          },
        },
      });
      expect(patchRes.ok(), `PATCH omnibus config failed: ${patchRes.status()}`).toBeTruthy();

      // Call omnibus-preview with the fake channel (country 'FR' not in ['DE'])
      const previewRes = await apiRequest(
        request,
        'GET',
        `/api/catalog/prices/omnibus-preview?priceKindId=${priceKindId}&currencyCode=EUR&channelId=${fakeChannelId}`,
        { token },
      );
      expect(previewRes.ok()).toBeTruthy();
      const previewBody = (await previewRes.json()) as Record<string, unknown> | null;

      // Must return a non-null block with not_in_eu_market reason
      expect(previewBody).not.toBeNull();
      expect(previewBody?.applicabilityReason).toBe('not_in_eu_market');
      expect(previewBody?.applicable).toBe(false);
      expect(previewBody?.lowestPriceNet).toBeNull();
      expect(previewBody?.lowestPriceGross).toBeNull();
    } finally {
      if (token) {
        const restore: Record<string, unknown> = {};
        if (originalConfig.enabled !== undefined) restore.enabled = originalConfig.enabled;
        if (originalConfig.enabledCountryCodes !== undefined)
          restore.enabledCountryCodes = originalConfig.enabledCountryCodes;
        // Remove fake channel from config
        const channels = (originalConfig.channels as Record<string, unknown>) ?? {};
        const { [fakeChannelId]: _removed, ...rest } = channels;
        restore.channels = rest;
        await apiRequest(request, 'PATCH', '/api/catalog/config/omnibus', {
          token,
          data: restore,
        }).catch(() => {});
      }
    }
  });
});
