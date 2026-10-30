import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  cleanupStorefrontFixture,
  createStorefrontFixture,
  storefrontGet,
  uniqueStamp,
  type StorefrontFixture,
} from './helpers';
import {
  STOREFRONT_ERROR_CACHE_CONTROL,
  STOREFRONT_PRODUCTS_PATH,
  cleanupStorefrontCatalogFixtures,
  createCategoryFixture,
  createOutOfStockPolicyFixture,
  createProductFixture,
  createStorefrontFixtureTracker,
  getStorefrontProduct,
  getStorefrontProducts,
  itemIds,
  setProductTranslationFixture,
} from './storefrontCatalogHelpers';

/**
 * TC-ECOM-012: storefront product query contract — grammar, localization, search, availability.
 * Source: .ai/specs/2026-08-14-storefront-public-api.md (rev 4) §12 "Contract and safety"
 * (unknown parameter 400, R6; pageSize above 100 rejected), "Localization" (unsupported locale
 * falls back with requestedLocale and effectiveLocale), "Search" (results are assortment-filtered),
 * "Availability" (page-scoped filter, D21/R15) and §4.1 query grammar.
 */

type InvalidQueryBody = { error: string; fields: Record<string, string> };

test.describe('TC-ECOM-012: storefront product query contract', () => {
  test.describe.configure({ timeout: 180_000 });

  test('unknown, repeated and out-of-range parameters are rejected with 400', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    let store: StorefrontFixture | null = null;
    try {
      store = await createStorefrontFixture(request, token, {});
      const host = store.hostname;
      const expectInvalid = async (path: string, parameter: string) => {
        const response = await storefrontGet(host, path);
        expect(response.status, `${path}: ${response.text}`).toBe(400);
        expect(response.headers['cache-control'], path).toBe(STOREFRONT_ERROR_CACHE_CONTROL);
        const body = response.body as InvalidQueryBody;
        expect(body.error, path).toBe('invalid_query');
        expect(Object.keys(body.fields), path).toContain(parameter);
        return body;
      };

      const unknown = await expectInvalid(`${STOREFRONT_PRODUCTS_PATH}?categry=shoes`, 'categry');
      expect(unknown.fields.categry).toBe('unknown parameter');
      await expectInvalid(`${STOREFRONT_PRODUCTS_PATH}?pageSize=101`, 'pageSize');
      await expectInvalid(`${STOREFRONT_PRODUCTS_PATH}?pageSize=0`, 'pageSize');
      const repeated = await expectInvalid(`${STOREFRONT_PRODUCTS_PATH}?page=1&page=2`, 'page');
      expect(repeated.fields.page).toBe('parameter given more than once');
      await expectInvalid(`${STOREFRONT_PRODUCTS_PATH}?options=red`, 'options');
      await expectInvalid(`${STOREFRONT_PRODUCTS_PATH}?sort=cheapest`, 'sort');
      await expectInvalid(`${STOREFRONT_PRODUCTS_PATH}/qa-ecom-012-any?colour=red`, 'colour');
      await expectInvalid(`${STOREFRONT_PRODUCTS_PATH}/qa-ecom-012-any?variantId=not-a-uuid`, 'variantId');

      const maxPage = await getStorefrontProducts(host, { query: { pageSize: '100' } });
      expect(maxPage.status, maxPage.text).toBe(200);
      expect(maxPage.list?.pageSize).toBe(100);
    } finally {
      await cleanupStorefrontFixture(request, token, store);
    }
  });

  test('locale fallback reports requested and effective locale and search stays inside the assortment', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    const searchToken = `lantern${stamp.replace(/[^a-z0-9]/gi, '')}`;
    const tracker = createStorefrontFixtureTracker();
    let store: StorefrontFixture | null = null;
    try {
      const rootId = await createCategoryFixture(request, token, tracker, { name: `QA ECOM 012 Root ${stamp}` });
      const outsideId = await createCategoryFixture(request, token, tracker, { name: `QA ECOM 012 Outside ${stamp}` });
      store = await createStorefrontFixture(request, token, {
        stamp,
        defaultLocale: 'en',
        supportedLocales: ['en', 'de'],
        channelAssortmentScope: { categoryIds: [rootId] },
      });
      const host = store.hostname;
      const translatedTitle = `QA ECOM 012 Laterne ${searchToken}`;
      const translatedId = await createProductFixture(request, token, tracker, {
        title: `QA ECOM 012 Lantern ${searchToken}`,
        handle: `qa-ecom-012-lantern-${stamp}`,
        sku: `QA-ECOM-012-L-${stamp}`,
        categoryIds: [rootId],
      });
      await setProductTranslationFixture(request, token, tracker, translatedId, { de: { title: translatedTitle } });
      const untranslatedTitle = `QA ECOM 012 Kettle ${stamp}`;
      const untranslatedId = await createProductFixture(request, token, tracker, {
        title: untranslatedTitle,
        handle: `qa-ecom-012-kettle-${stamp}`,
        sku: `QA-ECOM-012-K-${stamp}`,
        categoryIds: [rootId],
      });
      const outsideProductId = await createProductFixture(request, token, tracker, {
        title: `QA ECOM 012 Lantern ${searchToken} Outside`,
        handle: `qa-ecom-012-outside-${stamp}`,
        sku: `QA-ECOM-012-O-${stamp}`,
        categoryIds: [outsideId],
      });

      const unsupported = await getStorefrontProducts(host, { query: { locale: 'fr' } });
      expect(unsupported.status, unsupported.text).toBe(200);
      expect(unsupported.list?.requestedLocale).toBe('fr');
      expect(unsupported.list?.effectiveLocale).toBe('en');
      expect(unsupported.list?.items.find((item) => item.id === translatedId)?.title).toBe(
        `QA ECOM 012 Lantern ${searchToken}`,
      );

      const german = await getStorefrontProducts(host, { query: { locale: 'de' } });
      expect(german.status, german.text).toBe(200);
      expect(german.list?.requestedLocale).toBe('de');
      expect(german.list?.effectiveLocale).toBe('de');
      expect(german.list?.items.find((item) => item.id === translatedId)?.title).toBe(translatedTitle);
      expect(german.list?.items.find((item) => item.id === untranslatedId)?.title).toBe(untranslatedTitle);

      const negotiated = await getStorefrontProducts(host, { headers: { 'Accept-Language': 'de-DE,de;q=0.9' } });
      expect(negotiated.status, negotiated.text).toBe(200);
      expect(negotiated.list?.requestedLocale).toBeNull();
      expect(negotiated.list?.effectiveLocale).toBe('de');

      const germanDetail = await getStorefrontProduct(host, translatedId, { query: { locale: 'de' } });
      expect(germanDetail.status, germanDetail.text).toBe(200);
      expect(germanDetail.detail?.title).toBe(translatedTitle);
      const fallbackDetail = await getStorefrontProduct(host, untranslatedId, { query: { locale: 'de' } });
      expect(fallbackDetail.status, fallbackDetail.text).toBe(200);
      expect(fallbackDetail.detail?.title).toBe(untranslatedTitle);

      const search = await getStorefrontProducts(host, { query: { search: searchToken } });
      expect(search.status, search.text).toBe(200);
      expect(itemIds(search.list)).toEqual([translatedId]);
      expect(search.list?.total).toBe(1);
      expect(search.list?.appliedFilters.search).toBe(searchToken);
      expect(search.list?.appliedSort).toBe('relevance');
      expect(search.text).not.toContain(outsideProductId);

      const outsideOnly = await getStorefrontProducts(host, { query: { search: `${searchToken} Outside` } });
      expect(outsideOnly.status, outsideOnly.text).toBe(200);
      expect(outsideOnly.list?.items).toEqual([]);
      expect(outsideOnly.list?.total).toBe(0);
    } finally {
      await cleanupStorefrontCatalogFixtures(request, token, tracker);
      await cleanupStorefrontFixture(request, token, store);
    }
  });

  test('availability=in_stock filters the returned page only and keeps unfiltered totals', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    const tracker = createStorefrontFixtureTracker();
    let store: StorefrontFixture | null = null;
    try {
      const rootId = await createCategoryFixture(request, token, tracker, { name: `QA ECOM 012 Stock ${stamp}` });
      store = await createStorefrontFixture(request, token, {
        stamp,
        channelAssortmentScope: { categoryIds: [rootId] },
      });
      const host = store.hostname;
      const outOfStockId = await createProductFixture(request, token, tracker, {
        title: `QA ECOM 012 A Out Of Stock ${stamp}`,
        handle: `qa-ecom-012-oos-${stamp}`,
        sku: `QA-ECOM-012-OOS-${stamp}`,
        categoryIds: [rootId],
      });
      await createOutOfStockPolicyFixture(request, token, tracker, outOfStockId);
      const inStockId = await createProductFixture(request, token, tracker, {
        title: `QA ECOM 012 B In Stock ${stamp}`,
        handle: `qa-ecom-012-ins-${stamp}`,
        sku: `QA-ECOM-012-INS-${stamp}`,
        categoryIds: [rootId],
      });

      const unfiltered = await getStorefrontProducts(host, { query: { sort: 'title_asc', pageSize: '1' } });
      expect(unfiltered.status, unfiltered.text).toBe(200);
      expect(itemIds(unfiltered.list)).toEqual([outOfStockId]);
      expect(unfiltered.list?.items[0]?.availability).toMatchObject({ state: 'out_of_stock', canFulfil: false });
      expect(unfiltered.list?.appliedFilters.availability).toBeUndefined();

      const firstPage = await getStorefrontProducts(host, {
        query: { availability: 'in_stock', sort: 'title_asc', pageSize: '1', page: '1' },
      });
      expect(firstPage.status, firstPage.text).toBe(200);
      expect(firstPage.list?.items).toEqual([]);
      expect(firstPage.list?.total).toBe(2);
      expect(firstPage.list?.totalPages).toBe(2);
      expect(firstPage.list?.appliedFilters.availability).toEqual({ value: 'in_stock', scope: 'page' });

      const secondPage = await getStorefrontProducts(host, {
        query: { availability: 'in_stock', sort: 'title_asc', pageSize: '1', page: '2' },
      });
      expect(secondPage.status, secondPage.text).toBe(200);
      expect(itemIds(secondPage.list)).toEqual([inStockId]);
      expect(secondPage.list?.total).toBe(2);

      const available = await getStorefrontProducts(host, { query: { availability: 'available', sort: 'title_asc' } });
      expect(available.status, available.text).toBe(200);
      expect(itemIds(available.list)).toEqual([inStockId]);
      expect(available.list?.total).toBe(2);
      expect(available.list?.appliedFilters.availability).toEqual({ value: 'available', scope: 'page' });
    } finally {
      await cleanupStorefrontCatalogFixtures(request, token, tracker);
      await cleanupStorefrontFixture(request, token, store);
    }
  });
});
