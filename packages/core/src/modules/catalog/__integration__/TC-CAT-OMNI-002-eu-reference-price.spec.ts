import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  PRICES_PATH,
  PRODUCTS_PATH,
  cleanupOmnibusTenantActor,
  createOmnibusProductFixture,
  createOmnibusTenantActor,
  createPriceFixture,
  createPriceKindFixture,
  createSalesChannelFixture,
  deleteEntityIfExists,
  deleteSalesChannelIfExists,
  fetchOmnibusPreview,
  insertPriceHistoryRows,
  patchOmnibusConfig,
  readPriceKindCode,
  runOmnibusBackfillCli,
  uniqueStamp,
  type OmnibusBlock,
  type OmnibusTenantActor,
} from './omnibusHelpers';

/**
 * TC-CAT-OMNI-002: an announced promotion on an EU channel exposes the lowest prior price.
 * Source: `.ai/specs/2026-06-30-omnibus-price-tracking.md` — Phase 2 (`catalogOmnibusService`,
 * `GET /api/catalog/prices/omnibus-preview`, products-list `omnibus` block, the 422 backfill gate on
 * `PATCH /api/catalog/config/omnibus`) and Phase 3 (`omnibus:backfill` CLI), worked examples E1/E3
 * and edge cases EC-1 / EC-7.
 *
 * Scenario (lookback 30 days, axis gross, channel mapped to PL, PL enabled):
 * - history before the promotion: 110.00 recorded 40 days ago (the price in effect at window start),
 *   95.00 recorded 20 days ago (the lowest prior price), 120.00 recorded 10 days ago;
 * - the price is then reduced through the API to 80.00 with `startsAt` 5 minutes ago (announced).
 * Expected: reference `lowestPriceGross = 95.0000` (not the promo 80, not the window-start 110),
 * `previousPriceGross = 110.0000`, `applicable = true`, `announced_promotion`, window anchored on
 * `startsAt`. With Omnibus disabled the preview is `null` and the products list carries no block.
 *
 * The Omnibus config is tenant-wide, so the scenario runs in a fresh tenant. Older history rows are
 * inserted directly (the API always records "now"); the backfill CLI then records coverage for the
 * channel before the server ever reads this tenant's config, so the gate sees it without relying on
 * a shared cache between the CLI process and the app.
 */
const ACTOR_FEATURES = ['catalog.*', 'sales.*'];
const DAY_MS = 24 * 60 * 60 * 1000;

type ProductListBody = { items?: Array<{ id: string; omnibus?: OmnibusBlock }> };

test.describe('TC-CAT-OMNI-002: EU Omnibus reference price', () => {
  test.describe.configure({ timeout: 240_000 });

  test('promotion on an EU channel resolves the lowest prior price in preview and products list', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = uniqueStamp();
    let actor: OmnibusTenantActor | null = null;
    let channelId: string | null = null;
    let productId: string | null = null;
    let priceKindId: string | null = null;
    let priceId: string | null = null;
    try {
      actor = await createOmnibusTenantActor(request, superadminToken, stamp, ACTOR_FEATURES);
      const token = actor.token;
      channelId = await createSalesChannelFixture(request, token, stamp);
      priceKindId = await createPriceKindFixture(request, token, { stamp, suffix: 'eu' });
      productId = await createOmnibusProductFixture(request, token, stamp);
      priceId = await createPriceFixture(request, token, {
        productId,
        priceKindId,
        channelId,
        unitPriceNet: 97.561,
        unitPriceGross: 120,
      });

      const now = Date.now();
      const priceKindCode = await readPriceKindCode(priceKindId);
      const baseRow = {
        tenantId: actor.tenantId,
        organizationId: actor.organizationId,
        priceId,
        productId,
        channelId,
        priceKindId,
        priceKindCode,
        currencyCode: 'EUR',
        taxRate: '23.0000',
      };
      await insertPriceHistoryRows([
        { ...baseRow, unitPriceNet: '89.4309', unitPriceGross: '110.0000', recordedAt: new Date(now - 40 * DAY_MS), changeType: 'create' },
        { ...baseRow, unitPriceNet: '77.2358', unitPriceGross: '95.0000', recordedAt: new Date(now - 20 * DAY_MS), changeType: 'update' },
        { ...baseRow, unitPriceNet: '97.5610', unitPriceGross: '120.0000', recordedAt: new Date(now - 10 * DAY_MS), changeType: 'update' },
      ]);

      const promotionStartsAt = new Date(now - 5 * 60 * 1000).toISOString();
      const promotion = await apiRequest(request, 'PUT', PRICES_PATH, {
        token,
        data: {
          id: priceId,
          productId,
          priceKindId,
          currencyCode: 'EUR',
          channelId,
          unitPriceNet: 65.0407,
          unitPriceGross: 80,
          startsAt: promotionStartsAt,
        },
      });
      expect(promotion.status(), `promotion update should succeed (${await promotion.text()})`).toBe(200);

      const backfillOutput = runOmnibusBackfillCli({ tenantId: actor.tenantId, channelId });
      expect(backfillOutput).toContain('[omnibus:backfill] Complete');
      expect(backfillOutput).toContain(channelId);

      const previewQuery = { productId, priceKindId, currencyCode: 'EUR', channelId };
      const disabledPreview = await fetchOmnibusPreview(request, token, previewQuery);
      expect(disabledPreview.status, disabledPreview.text).toBe(200);
      expect(disabledPreview.body, 'Omnibus disabled -> preview is null').toBeNull();

      const disabledList = await apiRequest(
        request,
        'GET',
        `${PRODUCTS_PATH}?id=${productId}&channelId=${channelId}&pageSize=10`,
        { token },
      );
      expect(disabledList.status()).toBe(200);
      const disabledItem = (await readJsonSafe<ProductListBody>(disabledList))?.items?.find((item) => item.id === productId);
      expect(disabledItem, 'product should be listed').toBeTruthy();
      expect(disabledItem?.omnibus, 'Omnibus disabled -> no block on the products list').toBeUndefined();

      const uncoveredChannelId = randomUUID();
      const gated = await patchOmnibusConfig(request, token, {
        enabled: true,
        enabledCountryCodes: ['PL', 'DE'],
        lookbackDays: 30,
        channels: {
          [channelId]: { presentedPriceKindId: priceKindId, countryCode: 'PL' },
          [uncoveredChannelId]: { presentedPriceKindId: priceKindId, countryCode: 'DE' },
        },
      });
      expect(gated.status, JSON.stringify(gated.body)).toBe(422);
      expect(gated.body).toEqual({
        field: 'enabled',
        error: 'backfill_required_before_enable',
        channels: [uncoveredChannelId],
      });

      const enabled = await patchOmnibusConfig(request, token, {
        enabled: true,
        enabledCountryCodes: ['PL'],
        lookbackDays: 30,
        channels: { [channelId]: { presentedPriceKindId: priceKindId, countryCode: 'PL' } },
      });
      expect(enabled.status, JSON.stringify(enabled.body)).toBe(200);
      expect(enabled.body?.enabled).toBe(true);
      const coverage = enabled.body?.backfillCoverage as Record<string, { lookbackDays: number }> | undefined;
      expect(coverage?.[channelId]?.lookbackDays).toBe(30);

      const anchor = new Date(promotionStartsAt).getTime();
      const expectedBlock: OmnibusBlock = {
        presentedPriceKindId: priceKindId,
        lookbackDays: 30,
        minimizationAxis: 'gross',
        promotionAnchorAt: promotionStartsAt,
        windowStart: new Date(anchor - 30 * DAY_MS).toISOString(),
        windowEnd: promotionStartsAt,
        coverageStartAt: null,
        lowestPriceNet: '77.2358',
        lowestPriceGross: '95.0000',
        previousPriceNet: '89.4309',
        previousPriceGross: '110.0000',
        currencyCode: 'EUR',
        applicable: true,
        applicabilityReason: 'announced_promotion',
      };

      const preview = await fetchOmnibusPreview(request, token, previewQuery);
      expect(preview.status, preview.text).toBe(200);
      expect(preview.body).toEqual(expectedBlock);

      const enabledList = await apiRequest(
        request,
        'GET',
        `${PRODUCTS_PATH}?id=${productId}&channelId=${channelId}&pageSize=20`,
        { token },
      );
      expect(enabledList.status()).toBe(200);
      const enabledItem = (await readJsonSafe<ProductListBody>(enabledList))?.items?.find((item) => item.id === productId);
      expect(enabledItem?.omnibus).toEqual(expectedBlock);

      const otherCountry = await fetchOmnibusPreview(request, token, { ...previewQuery, channelId: randomUUID() });
      expect(otherCountry.status, otherCountry.text).toBe(200);
      expect(otherCountry.body?.applicabilityReason, 'unmapped channel is outside the EU market').toBe('not_in_eu_market');
      expect(otherCountry.body?.lowestPriceGross).toBeNull();

      const disabledAgain = await patchOmnibusConfig(request, token, { enabled: false });
      expect(disabledAgain.status, JSON.stringify(disabledAgain.body)).toBe(200);
      const previewAfterDisable = await fetchOmnibusPreview(request, token, previewQuery);
      expect(previewAfterDisable.status).toBe(200);
      expect(previewAfterDisable.body).toBeNull();
      const listAfterDisable = await apiRequest(
        request,
        'GET',
        `${PRODUCTS_PATH}?id=${productId}&channelId=${channelId}&pageSize=30`,
        { token },
      );
      const itemAfterDisable = (await readJsonSafe<ProductListBody>(listAfterDisable))?.items?.find(
        (item) => item.id === productId,
      );
      expect(itemAfterDisable, 'product should be listed').toBeTruthy();
      expect(itemAfterDisable?.omnibus).toBeUndefined();
    } finally {
      if (actor) {
        await deleteEntityIfExists(request, actor.token, PRICES_PATH, priceId);
        await deleteEntityIfExists(request, actor.token, PRODUCTS_PATH, productId);
        await deleteEntityIfExists(request, actor.token, '/api/catalog/price-kinds', priceKindId);
        await deleteSalesChannelIfExists(request, actor.token, channelId);
      }
      await cleanupOmnibusTenantActor(request, superadminToken, actor);
    }
  });
});
