import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';
import {
  cleanupStorefrontFixture,
  createPriceKindFixture,
  createStorefrontFixture,
  uniqueStamp,
  type StorefrontFixture,
} from './helpers';
import {
  cleanupStorefrontCatalogFixtures,
  createCategoryFixture,
  createPriceRowFixture,
  createProductFixture,
  createStorefrontFixtureTracker,
  getStorefrontProduct,
  getStorefrontProducts,
  getStorefrontSearchSuggest,
  itemPrice,
} from './storefrontCatalogHelpers';

/**
 * TC-ECOM-019: a price row that carries only its net side (written outside the catalog price
 * commands, e.g. by direct SQL or a custom importer) is shown on the storefront with the gross amount
 * cart/checkout charge for it. 22.09 net at 5.5% is exactly 23.30495, which rounds half-up to 23.305;
 * float math gives 23.3049. A one-sided row whose tax rate leaves no positive derivation factor
 * (for example -100%, which the admin API rejects but the column accepts) is shown without a price
 * instead of failing the page.
 */

const NET_PRICE = 22.09;
const TAX_RATE = 5.5;
const EXPECTED_GROSS = 23.305;

test.describe('TC-ECOM-019: storefront derives a missing gross side with exact decimals', () => {
  test.describe.configure({ timeout: 120_000 });

  test('product detail and listing show the exact derived gross amount', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const tracker = createStorefrontFixtureTracker();
    const holder: { store: StorefrontFixture | null } = { store: null };
    try {
      const stamp = uniqueStamp();
      const priceKindId = await createPriceKindFixture(request, token, {
        stamp,
        suffix: 'gross',
        displayMode: 'including-tax',
      });
      tracker.priceKindIds.push(priceKindId);
      const categoryId = await createCategoryFixture(request, token, tracker, { name: `QA ECOM 019 ${stamp}` });
      holder.store = await createStorefrontFixture(request, token, {
        stamp,
        channelPriceKindId: priceKindId,
        channelAssortmentScope: { categoryIds: [categoryId] },
      });
      const store = holder.store;
      const handle = `qa-ecom-019-${stamp}`;
      const productId = await createProductFixture(request, token, tracker, {
        title: `QA ECOM 019 Product ${stamp}`,
        handle,
        sku: `QA-ECOM-019-${stamp}`,
        categoryIds: [categoryId],
      });
      const priceId = await createPriceRowFixture(request, token, tracker, {
        productId,
        priceKindId,
        channelId: store.salesChannelId,
        unitPriceNet: NET_PRICE,
        unitPriceGross: EXPECTED_GROSS,
        taxRate: TAX_RATE,
      });
      await withClient(async (client) => {
        const result = await client.query(
          'update catalog_product_variant_prices set unit_price_gross = null where id = $1 and tenant_id = $2 and organization_id = $3',
          [priceId, store.tenantId, store.organizationId],
        );
        expect(result.rowCount).toBe(1);
      });

      const detail = await getStorefrontProduct(store.hostname, handle);
      expect(detail.status, detail.text).toBe(200);
      expect(detail.detail?.price).toMatchObject({ amount: EXPECTED_GROSS, displayMode: 'gross' });
      expect(detail.detail?.price?.formatted).toContain('23.31');

      const list = await getStorefrontProducts(store.hostname);
      expect(list.status, list.text).toBe(200);
      expect(itemPrice(list.list, productId)?.amount).toBe(EXPECTED_GROSS);
    } finally {
      await cleanupStorefrontCatalogFixtures(request, token, tracker);
      await cleanupStorefrontFixture(request, token, holder.store);
    }
  });

  test('a gross-only row with a -100% tax rate is shown without a net price on detail, listing and search', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const tracker = createStorefrontFixtureTracker();
    const holder: { store: StorefrontFixture | null } = { store: null };
    try {
      const stamp = uniqueStamp();
      const marker = `qaecom019neg${stamp.replace(/[^a-z0-9]/gi, '').toLowerCase()}`;
      const priceKindId = await createPriceKindFixture(request, token, {
        stamp,
        suffix: 'net',
        displayMode: 'excluding-tax',
      });
      tracker.priceKindIds.push(priceKindId);
      const categoryId = await createCategoryFixture(request, token, tracker, { name: `QA ECOM 019 Neg ${stamp}` });
      holder.store = await createStorefrontFixture(request, token, {
        stamp,
        channelPriceKindId: priceKindId,
        channelAssortmentScope: { categoryIds: [categoryId] },
      });
      const store = holder.store;
      const handle = `qa-ecom-019-neg-${stamp}`;
      const productId = await createProductFixture(request, token, tracker, {
        title: `QA ECOM 019 ${marker}`,
        handle,
        sku: `QA-ECOM-019-NEG-${stamp}`,
        categoryIds: [categoryId],
      });
      const priceId = await createPriceRowFixture(request, token, tracker, {
        productId,
        priceKindId,
        channelId: store.salesChannelId,
        unitPriceNet: NET_PRICE,
        unitPriceGross: EXPECTED_GROSS,
        taxRate: TAX_RATE,
      });
      await withClient(async (client) => {
        const result = await client.query(
          'update catalog_product_variant_prices set unit_price_net = null, tax_rate = -100 where id = $1 and tenant_id = $2 and organization_id = $3',
          [priceId, store.tenantId, store.organizationId],
        );
        expect(result.rowCount).toBe(1);
      });

      const detail = await getStorefrontProduct(store.hostname, handle);
      expect(detail.status, detail.text).toBe(200);
      expect(detail.detail?.price).toBeNull();

      const list = await getStorefrontProducts(store.hostname);
      expect(list.status, list.text).toBe(200);
      expect(list.list?.items.map((item) => item.id)).toContain(productId);
      expect(itemPrice(list.list, productId)).toBeNull();

      const search = await getStorefrontProducts(store.hostname, { query: { search: marker } });
      expect(search.status, search.text).toBe(200);
      expect(search.list?.items.map((item) => item.id)).toEqual([productId]);
      expect(itemPrice(search.list, productId)).toBeNull();

      await expect
        .poll(
          async () => {
            const suggest = await getStorefrontSearchSuggest(store.hostname, { query: { q: marker } });
            expect(suggest.status, suggest.text).toBe(200);
            return suggest.suggest?.products.find((product) => product.id === productId) ?? null;
          },
          { timeout: 60_000 },
        )
        .toMatchObject({ id: productId, formattedPrice: null });
    } finally {
      await cleanupStorefrontCatalogFixtures(request, token, tracker);
      await cleanupStorefrontFixture(request, token, holder.store);
    }
  });
});
