import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures';
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
  insertPriceHistoryRows,
  patchOmnibusConfig,
  readPriceKindCode,
  runOmnibusBackfillCli,
  uniqueStamp,
  type OmnibusTenantActor,
} from '../../catalog/__integration__/omnibusHelpers';

/**
 * TC-SALES-045: order lines freeze the Omnibus reference price they were sold with.
 * Source: `.ai/specs/2026-06-30-omnibus-price-tracking.md` — Phase 5 (six immutable snapshot
 * columns on `sales_order_lines` / `sales_quote_lines`, captured on line creation through the
 * optional `catalogOmnibusService`, never recomputed on edit; `is_personalized` disclosure).
 *
 * Scenario (lookback 30 days, channel mapped to PL): history 110.00 (40 days ago), 95.00 (20 days
 * ago), 120.00 (10 days ago), then a promotion to 80.00 starting 5 minutes ago. A line priced from
 * that price row is created with the order and another one through the line upsert route; both
 * carry reference 95.00 and `announced_promotion`. After Omnibus is disabled, editing a line keeps
 * its snapshot, while a line added afterwards has none.
 */
const ACTOR_FEATURES = ['catalog.*', 'sales.*'];
const DAY_MS = 24 * 60 * 60 * 1000;
const ORDER_LINES_PATH = '/api/sales/order-lines';

type OrderLineRow = {
  id: string;
  name?: string | null;
  omnibus_reference_net?: number | string | null;
  omnibus_reference_gross?: number | string | null;
  omnibus_promotion_anchor_at?: string | null;
  omnibus_applicability_reason?: string | null;
  is_personalized?: boolean | null;
  personalization_reason?: string | null;
};

async function readOrderLines(request: APIRequestContext, token: string, orderId: string): Promise<OrderLineRow[]> {
  const response = await apiRequest(
    request,
    'GET',
    `${ORDER_LINES_PATH}?orderId=${encodeURIComponent(orderId)}&pageSize=50`,
    { token },
  );
  expect(response.status()).toBe(200);
  return (await readJsonSafe<{ items?: OrderLineRow[] }>(response))?.items ?? [];
}

function referenceGross(line: OrderLineRow | undefined): number | null {
  const value = line?.omnibus_reference_gross;
  return value === null || value === undefined ? null : Number(value);
}

test.describe('TC-SALES-045: Omnibus snapshot on order lines', () => {
  test.describe.configure({ timeout: 240_000 });

  test('captures the reference price on new lines and never recomputes it', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = uniqueStamp();
    let actor: OmnibusTenantActor | null = null;
    let channelId: string | null = null;
    let productId: string | null = null;
    let priceKindId: string | null = null;
    let priceId: string | null = null;
    let orderId: string | null = null;
    try {
      actor = await createOmnibusTenantActor(request, superadminToken, stamp, ACTOR_FEATURES);
      const token = actor.token;
      channelId = await createSalesChannelFixture(request, token, stamp);
      priceKindId = await createPriceKindFixture(request, token, { stamp, suffix: 'line' });
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
      const enabled = await patchOmnibusConfig(request, token, {
        enabled: true,
        enabledCountryCodes: ['PL'],
        lookbackDays: 30,
        channels: { [channelId]: { presentedPriceKindId: priceKindId, countryCode: 'PL' } },
      });
      expect(enabled.status, JSON.stringify(enabled.body)).toBe(200);

      const pricedLine = (name: string) => ({
        currencyCode: 'EUR',
        quantity: 1,
        name,
        productId,
        priceId,
        unitPriceNet: 65.0407,
        unitPriceGross: 80,
      });
      const orderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: { currencyCode: 'EUR', lines: [pricedLine(`QA OMNI created ${stamp}`)] },
      });
      expect(orderResponse.status(), `order create should be 201 (${await orderResponse.text()})`).toBe(201);
      orderId = expectId((await readJsonSafe<{ id?: string }>(orderResponse))?.id, 'order id');

      const upserted = await apiRequest(request, 'POST', ORDER_LINES_PATH, {
        token,
        data: { orderId, ...pricedLine(`QA OMNI upserted ${stamp}`) },
      });
      expect(upserted.status(), `line upsert should be 201 (${await upserted.text()})`).toBe(201);

      const captured = await readOrderLines(request, token, orderId);
      const createdLine = captured.find((line) => line.name === `QA OMNI created ${stamp}`);
      const upsertedLine = captured.find((line) => line.name === `QA OMNI upserted ${stamp}`);
      for (const line of [createdLine, upsertedLine]) {
        expect(line, 'line should be listed').toBeTruthy();
        expect(referenceGross(line)).toBe(95);
        expect(line?.omnibus_applicability_reason).toBe('announced_promotion');
        expect(line?.omnibus_promotion_anchor_at && new Date(line.omnibus_promotion_anchor_at).toISOString()).toBe(
          promotionStartsAt,
        );
        expect(line?.is_personalized).toBe(false);
        expect(line?.personalization_reason ?? null).toBeNull();
      }

      const disabled = await patchOmnibusConfig(request, token, { enabled: false });
      expect(disabled.status, JSON.stringify(disabled.body)).toBe(200);

      const edited = await apiRequest(request, 'PUT', ORDER_LINES_PATH, {
        token,
        data: { id: createdLine?.id, orderId, ...pricedLine(`QA OMNI created ${stamp}`), quantity: 3 },
      });
      expect(edited.status(), `line update should succeed (${await edited.text()})`).toBe(200);
      const afterDisable = await apiRequest(request, 'POST', ORDER_LINES_PATH, {
        token,
        data: { orderId, ...pricedLine(`QA OMNI after disable ${stamp}`) },
      });
      expect(afterDisable.status(), `line upsert should be 201 (${await afterDisable.text()})`).toBe(201);

      const final = await readOrderLines(request, token, orderId);
      const editedLine = final.find((line) => line.id === createdLine?.id);
      expect(referenceGross(editedLine), 'an edit never recomputes the snapshot').toBe(95);
      expect(editedLine?.omnibus_applicability_reason).toBe('announced_promotion');
      const lateLine = final.find((line) => line.name === `QA OMNI after disable ${stamp}`);
      expect(lateLine, 'line added after disabling should be listed').toBeTruthy();
      expect(referenceGross(lateLine), 'Omnibus disabled -> no snapshot').toBeNull();
      expect(lateLine?.omnibus_applicability_reason ?? null).toBeNull();
    } finally {
      if (actor) {
        await deleteSalesEntityIfExists(request, actor.token, '/api/sales/orders', orderId);
        await deleteEntityIfExists(request, actor.token, PRICES_PATH, priceId);
        await deleteEntityIfExists(request, actor.token, PRODUCTS_PATH, productId);
        await deleteEntityIfExists(request, actor.token, '/api/catalog/price-kinds', priceKindId);
        await deleteSalesChannelIfExists(request, actor.token, channelId);
      }
      await cleanupOmnibusTenantActor(request, superadminToken, actor);
    }
  });
});
