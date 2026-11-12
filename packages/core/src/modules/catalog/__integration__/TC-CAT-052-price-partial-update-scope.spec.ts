import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures';
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-CAT-052: A partial price update does not need productId (#8103)
 *
 * `catalog.prices.update` used to leave `record.product` as an unloaded
 * reference, so the scope guards compared `undefined` to the caller's scope and
 * answered 403 for a price linked to a product but not to a variant, unless the
 * body repeated `productId`. These specs pin both sides of the boundary: partial
 * updates persist, and a caller outside the price's scope still gets 404.
 *
 * Self-contained: every fixture is created through the API and removed in `finally`.
 */
const PRICES_PATH = '/api/catalog/prices';
const PERIOD_END = '2031-01-01T00:00:00.000Z';

type PriceRow = Record<string, unknown> & { id?: string };

type PriceFixtures = {
  token: string;
  stamp: string;
  productId: string;
  priceKindId: string;
  priceId: string;
};

async function createEntity(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', path, { token, data });
  expect(response.status(), `POST ${path} should return 201`).toBe(201);
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, `POST ${path} should return an id`);
}

async function readPrice(
  request: APIRequestContext,
  token: string,
  priceId: string,
  productId: string,
): Promise<PriceRow> {
  const response = await apiRequest(
    request,
    'GET',
    `${PRICES_PATH}?id=${encodeURIComponent(priceId)}&productId=${encodeURIComponent(productId)}&page=1&pageSize=100`,
    { token },
  );
  expect(response.status(), 'prices should be readable').toBe(200);
  const items = (await readJsonSafe<{ items?: PriceRow[] }>(response))?.items ?? [];
  const row = items.find((item) => item.id === priceId);
  expect(row, `price ${priceId} should be listed`).toBeTruthy();
  return row as PriceRow;
}

function endsAtOf(row: PriceRow): string | null {
  const value = row.ends_at ?? row.endsAt;
  return value ? new Date(String(value)).toISOString() : null;
}

function offerIdOf(row: PriceRow): unknown {
  return row.offer_id ?? row.offerId ?? null;
}

async function updatePrice(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<number> {
  const response = await apiRequest(request, 'PUT', PRICES_PATH, { token, data });
  return response.status();
}

async function withProductScopedPrice(
  request: APIRequestContext,
  run: (fixtures: PriceFixtures) => Promise<void>,
): Promise<void> {
  const token = await getAuthToken(request, 'admin');
  const stamp = `${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
  let priceKindId: string | null = null;
  let productId: string | null = null;
  let priceId: string | null = null;

  try {
    priceKindId = await createEntity(request, token, '/api/catalog/price-kinds', {
      code: `qa-cat-052-${stamp}`,
      title: `QA Cat 052 ${stamp}`,
      displayMode: 'including-tax',
      currencyCode: 'USD',
      isPromotion: false,
    });
    productId = await createProductFixture(request, token, {
      title: `QA Cat 052 ${stamp}`,
      sku: `QA-CAT-052-${stamp}`,
    });
    priceId = await createEntity(request, token, PRICES_PATH, {
      productId,
      priceKindId,
      currencyCode: 'USD',
      unitPriceGross: 25,
    });
    const created = await readPrice(request, token, priceId, productId);
    expect(created.variant_id ?? created.variantId ?? null, 'the fixture must not be linked to a variant').toBeNull();

    await run({ token, stamp, productId, priceKindId, priceId });
  } finally {
    await deleteGeneralEntityIfExists(request, token, PRICES_PATH, priceId);
    await deleteCatalogProductIfExists(request, token, productId);
    await deleteGeneralEntityIfExists(request, token, '/api/catalog/price-kinds', priceKindId);
  }
}

test.describe('TC-CAT-052: partial price update without productId (#8103)', () => {
  test('persists partial updates on a price linked to a product but not a variant', async ({ request }) => {
    await withProductScopedPrice(request, async ({ token, productId, priceId }) => {
      expect(await updatePrice(request, token, { id: priceId, endsAt: PERIOD_END }), 'endsAt only').toBe(200);
      const closed = await readPrice(request, token, priceId, productId);
      expect(endsAtOf(closed), 'endsAt must be persisted').toBe(PERIOD_END);
      expect(closed.product_id ?? closed.productId, 'the product link must stay').toBe(productId);

      expect(await updatePrice(request, token, { id: priceId, unitPriceGross: 31 }), 'unitPriceGross only').toBe(200);
      const repriced = await readPrice(request, token, priceId, productId);
      expect(Number(repriced.unit_price_gross ?? repriced.unitPriceGross), 'the amount must be persisted').toBe(31);
      expect(endsAtOf(repriced), 'the earlier change must stay').toBe(PERIOD_END);
    });
  });

  test('attaches an offer, then updates the offer-linked price, without productId', async ({ request }) => {
    await withProductScopedPrice(request, async ({ token, stamp, productId, priceId }) => {
      let channelId: string | null = null;
      let offerId: string | null = null;
      try {
        channelId = await createEntity(request, token, '/api/sales/channels', {
          name: `QA Cat 052 ${stamp}`,
          code: `qa-cat-052-${stamp}`.replace(/_/g, '-'),
        });
        offerId = await createEntity(request, token, '/api/catalog/offers', {
          productId,
          channelId,
          title: `QA Cat 052 ${stamp}`,
        });

        expect(await updatePrice(request, token, { id: priceId, offerId }), 'offerId only').toBe(200);
        const linked = await readPrice(request, token, priceId, productId);
        expect(offerIdOf(linked), 'the offer link must be persisted').toBe(offerId);

        expect(await updatePrice(request, token, { id: priceId, endsAt: PERIOD_END }), 'endsAt on offer-linked').toBe(200);
        const closed = await readPrice(request, token, priceId, productId);
        expect(endsAtOf(closed), 'endsAt must be persisted').toBe(PERIOD_END);
        expect(offerIdOf(closed), 'the offer link must stay').toBe(offerId);
      } finally {
        await updatePrice(request, token, { id: priceId, offerId: null });
        await deleteGeneralEntityIfExists(request, token, '/api/catalog/offers', offerId);
        await deleteGeneralEntityIfExists(request, token, '/api/sales/channels', channelId);
      }
    });
  });

  test('still answers 404 outside the price scope and for an unknown id', async ({ request }) => {
    await withProductScopedPrice(request, async ({ token, stamp, productId, priceId }) => {
      const { tenantId } = getTokenContext(token);
      const password = 'StrongSecret123!';
      const email = `qa-tc-cat-052-${stamp}@example.com`;
      let organizationId: string | null = null;
      let roleId: string | null = null;
      let userId: string | null = null;
      try {
        expect(
          await updatePrice(request, token, { id: randomUUID(), endsAt: PERIOD_END }),
          'an unknown price id must answer 404',
        ).toBe(404);

        organizationId = await createOrganizationFixture(request, token, {
          name: `QA Cat 052 ${stamp}`,
          tenantId,
        });
        roleId = await createRoleFixture(request, token, { name: `qa-tc-cat-052-${stamp}`, tenantId });
        await setRoleAclFeatures(request, token, {
          roleId,
          features: ['catalog.products.view', 'catalog.pricing.manage'],
          organizations: [organizationId],
        });
        userId = await createUserFixture(request, token, {
          email,
          password,
          organizationId,
          roles: [roleId],
          name: 'QA TC-CAT-052 Actor',
        });
        const outsiderToken = await getAuthToken(request, email, password);

        expect(
          await updatePrice(request, outsiderToken, { id: priceId, endsAt: PERIOD_END }),
          'a caller limited to another organization must answer 404',
        ).toBe(404);
        const untouched = await readPrice(request, token, priceId, productId);
        expect(endsAtOf(untouched), 'a rejected update must not change the row').toBeNull();
      } finally {
        await deleteUserIfExists(request, token, userId);
        await deleteRoleIfExists(request, token, roleId);
        await deleteOrganizationIfExists(request, token, organizationId);
      }
    });
  });
});
