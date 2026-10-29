import { expect, test, type APIRequestContext } from '@playwright/test';
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
  type OmnibusTenantActor,
} from './omnibusHelpers';

/**
 * TC-CAT-OMNI-005: member-state derogations of the Omnibus reference price.
 * Source: `.ai/specs/2026-06-30-omnibus-price-tracking.md` — Phase 4 (product/variant
 * `omnibus_exempt`, product `first_listed_at`, per-channel `perishableGoodsRule`, `newArrivalRule`,
 * `newArrivalsLookbackDays` on `PATCH /api/catalog/config/omnibus`), edge cases EC-16..EC-19.
 *
 * Scenario (lookback 30 days, axis gross, channel mapped to PL):
 * - history: 110.00 recorded 40 days ago, 95.00 recorded 20 days ago, 120.00 recorded 10 days ago;
 *   the price is then reduced through the API to 80.00 with `startsAt` 5 minutes ago.
 * - perishable `exempt` + product marked perishable -> no reference (`perishable_exempt`);
 * - perishable `last_price` -> the price live right before the reduction (120.00);
 * - product no longer perishable -> the standard reference (95.00);
 * - new arrival `shorter_window` of 7 days + product listed 3 days ago -> a 7-day window whose
 *   reference is the price in effect at its start (120.00).
 */
const ACTOR_FEATURES = ['catalog.*', 'sales.*'];
const DAY_MS = 24 * 60 * 60 * 1000;

type ProductRecord = { id: string; omnibus_exempt?: boolean | null; first_listed_at?: string | null };

async function readProduct(request: APIRequestContext, token: string, productId: string): Promise<ProductRecord | null> {
  const response = await apiRequest(request, 'GET', `${PRODUCTS_PATH}?id=${productId}&pageSize=1`, { token });
  expect(response.status()).toBe(200);
  const body = await readJsonSafe<{ items?: ProductRecord[] }>(response);
  return body?.items?.find((item) => item.id === productId) ?? null;
}

async function updateProduct(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', PRODUCTS_PATH, { token, data });
  expect(response.status(), `product update should succeed (${await response.text()})`).toBe(200);
}

test.describe('TC-CAT-OMNI-005: Omnibus member-state derogations', () => {
  test.describe.configure({ timeout: 240_000 });

  test('perishable and new-arrival rules change the reference price per channel', async ({ request }) => {
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
      priceKindId = await createPriceKindFixture(request, token, { stamp, suffix: 'derog' });
      productId = await createOmnibusProductFixture(request, token, stamp);

      const created = await readProduct(request, token, productId);
      expect(created?.omnibus_exempt, 'a new product is not perishable').toBe(false);
      expect(created?.first_listed_at, 'first_listed_at defaults to the creation time').toBeTruthy();

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

      const channelConfig = (rules: Record<string, unknown>) => ({
        [channelId as string]: { presentedPriceKindId: priceKindId, countryCode: 'PL', ...rules },
      });
      const invalid = await patchOmnibusConfig(request, token, {
        channels: channelConfig({ perishableGoodsRule: 'never' }),
      });
      expect(invalid.status, JSON.stringify(invalid.body)).toBe(400);

      const exempt = await patchOmnibusConfig(request, token, {
        enabled: true,
        enabledCountryCodes: ['PL'],
        lookbackDays: 30,
        channels: channelConfig({ perishableGoodsRule: 'exempt' }),
      });
      expect(exempt.status, JSON.stringify(exempt.body)).toBe(200);
      const storedChannels = exempt.body?.channels as Record<string, Record<string, unknown>> | undefined;
      expect(storedChannels?.[channelId]?.perishableGoodsRule).toBe('exempt');

      await updateProduct(request, token, { id: productId, omnibusExempt: true });
      expect((await readProduct(request, token, productId))?.omnibus_exempt).toBe(true);

      const previewQuery = { productId, priceKindId, currencyCode: 'EUR', channelId };
      const exemptPreview = await fetchOmnibusPreview(request, token, previewQuery);
      expect(exemptPreview.status, exemptPreview.text).toBe(200);
      expect(exemptPreview.body).toMatchObject({
        applicabilityReason: 'perishable_exempt',
        applicable: false,
        lowestPriceGross: null,
      });

      const lastPrice = await patchOmnibusConfig(request, token, {
        channels: channelConfig({ perishableGoodsRule: 'last_price' }),
      });
      expect(lastPrice.status, JSON.stringify(lastPrice.body)).toBe(200);
      const lastPricePreview = await fetchOmnibusPreview(request, token, previewQuery);
      expect(lastPricePreview.body).toMatchObject({
        applicabilityReason: 'perishable_last_price',
        applicable: true,
        lowestPriceGross: '120.0000',
      });

      await updateProduct(request, token, { id: productId, omnibusExempt: false });
      const standardPreview = await fetchOmnibusPreview(request, token, previewQuery);
      expect(standardPreview.body).toMatchObject({
        applicabilityReason: 'announced_promotion',
        lookbackDays: 30,
        lowestPriceGross: '95.0000',
      });

      const newArrival = await patchOmnibusConfig(request, token, {
        channels: channelConfig({ newArrivalRule: 'shorter_window', newArrivalsLookbackDays: 7 }),
      });
      expect(newArrival.status, JSON.stringify(newArrival.body)).toBe(200);
      await updateProduct(request, token, { id: productId, firstListedAt: new Date(now - 3 * DAY_MS).toISOString() });
      const newArrivalPreview = await fetchOmnibusPreview(request, token, previewQuery);
      const anchor = new Date(promotionStartsAt).getTime();
      expect(newArrivalPreview.body).toMatchObject({
        applicabilityReason: 'new_arrival_reduced_window',
        lookbackDays: 7,
        windowStart: new Date(anchor - 7 * DAY_MS).toISOString(),
        lowestPriceGross: '120.0000',
      });

      await updateProduct(request, token, { id: productId, firstListedAt: new Date(now - 90 * DAY_MS).toISOString() });
      const establishedPreview = await fetchOmnibusPreview(request, token, previewQuery);
      expect(establishedPreview.body).toMatchObject({
        applicabilityReason: 'announced_promotion',
        lookbackDays: 30,
        lowestPriceGross: '95.0000',
      });
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
