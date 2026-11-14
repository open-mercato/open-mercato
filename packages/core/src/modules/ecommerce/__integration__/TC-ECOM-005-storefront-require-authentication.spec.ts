import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  CHANNEL_BINDINGS_PATH,
  PRIVATE_CACHE_CONTROL,
  cleanupStorefrontFixture,
  createPriceKindFixture,
  createStorefrontFixture,
  getStorefrontContext,
  uniqueStamp,
  type StorefrontFixture,
} from './helpers';
import {
  DETAIL_ANONYMOUS_CACHE_CONTROL,
  LISTING_ANONYMOUS_CACHE_CONTROL,
  PRODUCT_NOT_FOUND_BODY,
  STOREFRONT_ERROR_CACHE_CONTROL,
  cleanupStorefrontCatalogFixtures,
  createCategoryFixture,
  createCompanyBuyerFixture,
  createPriceRowFixture,
  createProductFixture,
  createStorefrontFixtureTracker,
  getStorefrontProduct,
  getStorefrontProducts,
  itemIds,
  type StorefrontFixtureTracker,
} from './storefrontCatalogHelpers';

/**
 * TC-ECOM-005: channel binding `requireAuthentication` gate.
 * Source: .ai/specs/2026-08-21-buyer-scoped-catalog-visibility.md §3.4, the edge-case table and
 * §11 (Phase 2 gate); isolation baseline TC-ECOM-010..012 stays unmodified.
 *
 * The channel binding restricts the assortment to one category holding one product. With the gate
 * on, an anonymous buyer resolves to an empty assortment (empty listing, product-not-found detail,
 * never a 503) while an authenticated portal buyer keeps seeing the product.
 */

type GatedFixture = {
  store: StorefrontFixture;
  product: { id: string; handle: string };
};

const MISSING_HANDLE = 'qa-ecom-005-handle-that-does-not-exist';

async function setRequireAuthentication(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  bindingId: string,
  requireAuthentication: boolean,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', CHANNEL_BINDINGS_PATH, {
    token,
    data: { id: bindingId, requireAuthentication },
  });
  expect(response.status(), `channel binding update should be 200 (${await response.text()})`).toBe(200);
}

async function createGatedFixture(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  tracker: StorefrontFixtureTracker,
  holder: { store: StorefrontFixture | null },
): Promise<GatedFixture> {
  const stamp = uniqueStamp();
  const priceKindId = await createPriceKindFixture(request, token, {
    stamp,
    suffix: 'regular',
    displayMode: 'including-tax',
  });
  tracker.priceKindIds.push(priceKindId);
  const categoryId = await createCategoryFixture(request, token, tracker, { name: `QA ECOM 005 Category ${stamp}` });
  const store = await createStorefrontFixture(request, token, {
    stamp,
    channelPriceKindId: priceKindId,
    channelAssortmentScope: { categoryIds: [categoryId] },
  });
  holder.store = store;
  const handle = `qa-ecom-005-${stamp}`;
  const productId = await createProductFixture(request, token, tracker, {
    title: `QA ECOM 005 Product ${stamp}`,
    handle,
    sku: `QA-ECOM-005-${stamp}`,
    categoryIds: [categoryId],
  });
  await createPriceRowFixture(request, token, tracker, {
    productId,
    priceKindId,
    channelId: store.salesChannelId,
    unitPriceNet: 100,
    unitPriceGross: 123,
  });
  return { store, product: { id: productId, handle } };
}

test.describe('TC-ECOM-005: storefront requireAuthentication gate', () => {
  test.describe.configure({ timeout: 180_000 });

  test('an anonymous buyer sees an empty listing and not-found details while a portal buyer sees the product', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const tracker = createStorefrontFixtureTracker();
    const holder: { store: StorefrontFixture | null } = { store: null };
    try {
      const fixture = await createGatedFixture(request, token, tracker, holder);
      const host = fixture.store.hostname;
      const bindingId = fixture.store.channelBindingId as string;

      const openList = await getStorefrontProducts(host);
      expect(openList.status, openList.text).toBe(200);
      expect(itemIds(openList.list)).toEqual([fixture.product.id]);

      await setRequireAuthentication(request, token, bindingId, true);

      const closedList = await getStorefrontProducts(host);
      expect(closedList.status, closedList.text).toBe(200);
      expect(closedList.list?.items).toEqual([]);
      expect(closedList.list?.total).toBe(0);
      expect(closedList.list?.totalPages).toBe(0);

      const closedDetail = await getStorefrontProduct(host, fixture.product.handle);
      const closedDetailById = await getStorefrontProduct(host, fixture.product.id);
      const missingDetail = await getStorefrontProduct(host, MISSING_HANDLE);
      for (const response of [closedDetail, closedDetailById, missingDetail]) {
        expect(response.status, response.text).toBe(404);
        expect(response.body).toEqual(PRODUCT_NOT_FOUND_BODY);
        expect(response.headers['cache-control']).toBe(STOREFRONT_ERROR_CACHE_CONTROL);
      }
      expect(closedDetail.text).toBe(missingDetail.text);

      const closedContext = await getStorefrontContext(host);
      expect(closedContext.status, closedContext.text).toBe(200);

      const buyer = await createCompanyBuyerFixture(request, token, tracker, { stamp: fixture.store.stamp, label: '005' });
      const buyerOptions = { cookie: buyer.session.cookieHeader };

      const buyerList = await getStorefrontProducts(host, buyerOptions);
      expect(buyerList.status, buyerList.text).toBe(200);
      expect(buyerList.headers['cache-control']).toBe(PRIVATE_CACHE_CONTROL);
      expect(itemIds(buyerList.list)).toEqual([fixture.product.id]);
      expect(buyerList.list?.total).toBe(1);

      const buyerDetail = await getStorefrontProduct(host, fixture.product.handle, buyerOptions);
      expect(buyerDetail.status, buyerDetail.text).toBe(200);
      expect(buyerDetail.headers['cache-control']).toBe(PRIVATE_CACHE_CONTROL);
      expect(buyerDetail.detail?.id).toBe(fixture.product.id);

      const buyerByBearer = await getStorefrontProducts(host, { bearer: buyer.session.authToken });
      expect(buyerByBearer.status, buyerByBearer.text).toBe(200);
      expect(itemIds(buyerByBearer.list)).toEqual([fixture.product.id]);

      const buyerContext = await getStorefrontContext(host, buyerOptions);
      expect(buyerContext.status, buyerContext.text).toBe(200);
    } finally {
      await cleanupStorefrontCatalogFixtures(request, token, tracker);
      await cleanupStorefrontFixture(request, token, holder.store);
    }
  });

  test('toggling the gate off reopens the catalog to anonymous buyers without a stale empty response', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const tracker = createStorefrontFixtureTracker();
    const holder: { store: StorefrontFixture | null } = { store: null };
    try {
      const fixture = await createGatedFixture(request, token, tracker, holder);
      const host = fixture.store.hostname;
      const bindingId = fixture.store.channelBindingId as string;

      const warmOpen = await getStorefrontProducts(host);
      expect(itemIds(warmOpen.list)).toEqual([fixture.product.id]);

      await setRequireAuthentication(request, token, bindingId, true);
      const closed = await getStorefrontProducts(host);
      expect(closed.status, closed.text).toBe(200);
      expect(closed.list?.total).toBe(0);
      const closedDetail = await getStorefrontProduct(host, fixture.product.handle);
      expect(closedDetail.status, closedDetail.text).toBe(404);

      await setRequireAuthentication(request, token, bindingId, false);
      const reopened = await getStorefrontProducts(host);
      expect(reopened.status, reopened.text).toBe(200);
      expect(reopened.headers['cache-control']).toBe(LISTING_ANONYMOUS_CACHE_CONTROL);
      expect(itemIds(reopened.list)).toEqual([fixture.product.id]);
      const reopenedDetail = await getStorefrontProduct(host, fixture.product.handle);
      expect(reopenedDetail.status, reopenedDetail.text).toBe(200);
      expect(reopenedDetail.headers['cache-control']).toBe(DETAIL_ANONYMOUS_CACHE_CONTROL);
      expect(reopenedDetail.detail?.id).toBe(fixture.product.id);

      await setRequireAuthentication(request, token, bindingId, true);
      const closedAgain = await getStorefrontProducts(host);
      expect(closedAgain.status, closedAgain.text).toBe(200);
      expect(closedAgain.list?.total).toBe(0);
    } finally {
      await cleanupStorefrontCatalogFixtures(request, token, tracker);
      await cleanupStorefrontFixture(request, token, holder.store);
    }
  });

  test('interleaved anonymous and authenticated requests on a closed channel never bleed through the cache', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const tracker = createStorefrontFixtureTracker();
    const holder: { store: StorefrontFixture | null } = { store: null };
    try {
      const fixture = await createGatedFixture(request, token, tracker, holder);
      const host = fixture.store.hostname;
      await setRequireAuthentication(request, token, fixture.store.channelBindingId as string, true);
      const buyer = await createCompanyBuyerFixture(request, token, tracker, { stamp: fixture.store.stamp, label: '005b' });
      const buyerOptions = { cookie: buyer.session.cookieHeader };

      for (let round = 0; round < 3; round += 1) {
        const anonymousList = await getStorefrontProducts(host);
        expect(anonymousList.status, anonymousList.text).toBe(200);
        expect(anonymousList.list?.items, `round ${round} anonymous listing`).toEqual([]);
        expect(anonymousList.list?.total).toBe(0);

        const buyerList = await getStorefrontProducts(host, buyerOptions);
        expect(buyerList.status, buyerList.text).toBe(200);
        expect(itemIds(buyerList.list), `round ${round} buyer listing`).toEqual([fixture.product.id]);

        const anonymousDetail = await getStorefrontProduct(host, fixture.product.handle);
        expect(anonymousDetail.status, `round ${round} anonymous detail`).toBe(404);
        expect(anonymousDetail.body).toEqual(PRODUCT_NOT_FOUND_BODY);

        const buyerDetail = await getStorefrontProduct(host, fixture.product.handle, buyerOptions);
        expect(buyerDetail.status, `round ${round} buyer detail`).toBe(200);
        expect(buyerDetail.detail?.id).toBe(fixture.product.id);
      }
    } finally {
      await cleanupStorefrontCatalogFixtures(request, token, tracker);
      await cleanupStorefrontFixture(request, token, holder.store);
    }
  });
});
