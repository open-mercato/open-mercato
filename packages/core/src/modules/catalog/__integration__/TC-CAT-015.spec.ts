import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-CAT-015: Omnibus Config GET and PATCH
 * Source: SPEC-033 — Omnibus Price Tracking, GET/PATCH /api/catalog/config/omnibus
 */
test.describe('TC-CAT-015: Omnibus Config GET and PATCH', () => {
  test('should read and update omnibus configuration', async ({ request }) => {
    let token: string | null = null;
    let originalConfig: Record<string, unknown> = {};

    try {
      token = await getAuthToken(request);

      // GET returns current config (may be empty object on fresh tenant)
      const getRes = await apiRequest(request, 'GET', '/api/catalog/config/omnibus', { token });
      expect(getRes.ok(), `GET /api/catalog/config/omnibus failed: ${getRes.status()}`).toBeTruthy();
      originalConfig = ((await getRes.json()) as Record<string, unknown>) ?? {};
      expect(typeof originalConfig === 'object' && originalConfig !== null).toBeTruthy();

      // PATCH updates lookbackDays
      const patchRes = await apiRequest(request, 'PATCH', '/api/catalog/config/omnibus', {
        token,
        data: { lookbackDays: 45 },
      });
      expect(patchRes.ok(), `PATCH /api/catalog/config/omnibus failed: ${patchRes.status()}`).toBeTruthy();
      const patchBody = (await patchRes.json()) as Record<string, unknown>;
      expect(patchBody.lookbackDays).toBe(45);

      // Subsequent GET reflects the patched value
      const getAfterRes = await apiRequest(request, 'GET', '/api/catalog/config/omnibus', { token });
      expect(getAfterRes.ok()).toBeTruthy();
      const getAfterBody = (await getAfterRes.json()) as Record<string, unknown>;
      expect(getAfterBody.lookbackDays).toBe(45);

      // Enabling Omnibus without backfill for a configured EU channel must return 422
      const priceKindsRes = await apiRequest(request, 'GET', '/api/catalog/price-kinds?pageSize=1', { token });
      expect(priceKindsRes.ok()).toBeTruthy();
      const priceKindsBody = (await priceKindsRes.json()) as { items?: { id: string }[] };
      const priceKindId = priceKindsBody.items?.[0]?.id;

      if (priceKindId) {
        const enableWithChannelRes = await apiRequest(request, 'PATCH', '/api/catalog/config/omnibus', {
          token,
          data: {
            enabled: true,
            enabledCountryCodes: ['DE'],
            defaultPresentedPriceKindId: priceKindId,
            channels: {
              'fake-channel-id-no-backfill': {
                presentedPriceKindId: priceKindId,
                countryCode: 'DE',
              },
            },
          },
        });
        // Should reject with 422 because the channel has no backfill coverage entry
        expect(enableWithChannelRes.status()).toBe(422);
        const errBody = (await enableWithChannelRes.json()) as { error?: string };
        expect(errBody.error).toBe('backfill_required_before_enable');
      }
    } finally {
      // Restore config to original state
      if (token) {
        const restore: Record<string, unknown> = { lookbackDays: originalConfig.lookbackDays ?? 30 };
        if (originalConfig.enabled !== undefined) restore.enabled = originalConfig.enabled;
        await apiRequest(request, 'PATCH', '/api/catalog/config/omnibus', {
          token,
          data: restore,
        }).catch(() => {});
      }
    }
  });
});
