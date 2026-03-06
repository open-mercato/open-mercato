import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-CAT-020: missing_channel_context — noChannelMode=require_channel and no channelId provided
 * Source: SPEC-033 — Omnibus Price Tracking, Phase 2
 */
test.describe('TC-CAT-020: Omnibus — missing_channel_context reason', () => {
  test('require_channel mode without channelId returns missing_channel_context block', async ({ request }) => {
    let token: string | null = null;
    let originalConfig: Record<string, unknown> = {};

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

      // Configure: enabled=true, noChannelMode=require_channel, enabledCountryCodes=['DE']
      const patchRes = await apiRequest(request, 'PATCH', '/api/catalog/config/omnibus', {
        token,
        data: {
          enabled: true,
          noChannelMode: 'require_channel',
          enabledCountryCodes: ['DE'],
        },
      });
      expect(patchRes.ok(), `PATCH omnibus config failed: ${patchRes.status()}`).toBeTruthy();

      // Call omnibus-preview WITHOUT channelId — should return missing_channel_context
      const previewRes = await apiRequest(
        request,
        'GET',
        `/api/catalog/prices/omnibus-preview?priceKindId=${priceKindId}&currencyCode=EUR`,
        { token },
      );
      expect(previewRes.ok()).toBeTruthy();
      const previewBody = (await previewRes.json()) as Record<string, unknown> | null;

      // Must return a non-null block with missing_channel_context reason
      expect(previewBody).not.toBeNull();
      expect(previewBody?.applicabilityReason).toBe('missing_channel_context');
      expect(previewBody?.applicable).toBe(false);
    } finally {
      if (token) {
        const restore: Record<string, unknown> = {};
        if (originalConfig.enabled !== undefined) restore.enabled = originalConfig.enabled;
        if (originalConfig.noChannelMode !== undefined) restore.noChannelMode = originalConfig.noChannelMode;
        if (originalConfig.enabledCountryCodes !== undefined)
          restore.enabledCountryCodes = originalConfig.enabledCountryCodes;
        await apiRequest(request, 'PATCH', '/api/catalog/config/omnibus', {
          token,
          data: restore,
        }).catch(() => {});
      }
    }
  });
});
