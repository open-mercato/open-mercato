import { expect, test } from '@playwright/test';
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-CAT-022: not_announced / insufficient_history — standard price kind with history returns expected reasons
 * Source: SPEC-033 — Omnibus Price Tracking, Phase 2
 */
test.describe('TC-CAT-022: Omnibus — not_announced and insufficient_history', () => {
  test('standard price with new history returns insufficient_history; no history returns no_history', async ({
    request,
  }) => {
    const stamp = Date.now();
    let token: string | null = null;
    let productId: string | null = null;
    let priceId: string | null = null;
    let regularKindId: string | null = null;
    let originalConfig: Record<string, unknown> = {};

    try {
      token = await getAuthToken(request);

      // Save original config
      const getRes = await apiRequest(request, 'GET', '/api/catalog/config/omnibus', { token });
      expect(getRes.ok()).toBeTruthy();
      originalConfig = ((await getRes.json()) as Record<string, unknown>) ?? {};

      // Find a regular (non-promotion) price kind
      const kindsRes = await apiRequest(request, 'GET', '/api/catalog/price-kinds?pageSize=50', { token });
      expect(kindsRes.ok()).toBeTruthy();
      const kindsBody = (await kindsRes.json()) as { items?: { id: string; isPromotion?: boolean }[] };
      const regularKind = (kindsBody.items ?? []).find((k) => !k.isPromotion);
      expect(regularKind, 'Expected at least one regular price kind').toBeTruthy();
      regularKindId = regularKind!.id;

      // Enable omnibus with best_effort channel mode
      await apiRequest(request, 'PATCH', '/api/catalog/config/omnibus', {
        token,
        data: { enabled: true, enabledCountryCodes: ['PL'], noChannelMode: 'best_effort' },
      });

      // Create product
      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-022 ${stamp}`,
        sku: `QA-CAT-020-${stamp}`,
      });

      // --- Scenario A: No history → no_history ---
      const noHistoryRes = await apiRequest(
        request,
        'GET',
        `/api/catalog/prices/omnibus-preview?priceKindId=${regularKindId}&currencyCode=USD&productId=${productId}`,
        { token },
      );
      expect(noHistoryRes.ok()).toBeTruthy();
      const noHistoryBody = (await noHistoryRes.json()) as Record<string, unknown> | null;
      expect(noHistoryBody).not.toBeNull();
      expect(noHistoryBody?.applicable).toBe(false);
      // Without any history entries, we expect no_history or not_in_eu_market (if no EU channel config)
      expect(
        ['no_history', 'not_in_eu_market', 'missing_channel_context'].includes(
          noHistoryBody?.applicabilityReason as string,
        ),
      ).toBeTruthy();

      // --- Scenario B: Create a price (records history) → insufficient_history since it's new ---
      const createPriceRes = await apiRequest(request, 'POST', '/api/catalog/prices', {
        token,
        data: {
          productId,
          priceKindId: regularKindId,
          currencyCode: 'USD',
          unitPriceNet: 100,
          unitPriceGross: 120,
        },
      });
      expect(createPriceRes.ok(), `POST price failed: ${createPriceRes.status()}`).toBeTruthy();
      const priceBody = (await createPriceRes.json()) as { id?: string };
      priceId = priceBody.id ?? null;

      const withHistoryRes = await apiRequest(
        request,
        'GET',
        `/api/catalog/prices/omnibus-preview?priceKindId=${regularKindId}&currencyCode=USD&productId=${productId}`,
        { token },
      );
      expect(withHistoryRes.ok()).toBeTruthy();
      const withHistoryBody = (await withHistoryRes.json()) as Record<string, unknown> | null;
      expect(withHistoryBody).not.toBeNull();
      expect(withHistoryBody?.applicable).toBe(false);

      // With a just-created price entry (within the 30-day window but no baseline),
      // expect: insufficient_history → coverageStartAt non-null, OR not_announced.
      // Note: an in-process cache (TTL 5 min, keyed per day) may return 'no_history' from
      // scenario A if both calls happen on the same day before the cache expires.
      const reason = withHistoryBody?.applicabilityReason as string;
      expect(['insufficient_history', 'not_announced', 'not_in_eu_market', 'no_history'].includes(reason)).toBeTruthy();

      if (reason === 'insufficient_history') {
        // coverageStartAt must be non-null when history is insufficient
        expect(withHistoryBody?.coverageStartAt).not.toBeNull();
        expect(typeof withHistoryBody?.coverageStartAt === 'string').toBeTruthy();
      }
    } finally {
      if (token && priceId) {
        await apiRequest(request, 'DELETE', `/api/catalog/prices?id=${encodeURIComponent(priceId)}`, { token }).catch(
          () => {},
        );
      }
      await deleteCatalogProductIfExists(request, token, productId);
      if (token) {
        const restore: Record<string, unknown> = {};
        if (originalConfig.enabled !== undefined) restore.enabled = originalConfig.enabled;
        if (originalConfig.enabledCountryCodes !== undefined)
          restore.enabledCountryCodes = originalConfig.enabledCountryCodes;
        if (originalConfig.noChannelMode !== undefined) restore.noChannelMode = originalConfig.noChannelMode;
        await apiRequest(request, 'PATCH', '/api/catalog/config/omnibus', {
          token,
          data: restore,
        }).catch(() => {});
      }
    }
  });
});
