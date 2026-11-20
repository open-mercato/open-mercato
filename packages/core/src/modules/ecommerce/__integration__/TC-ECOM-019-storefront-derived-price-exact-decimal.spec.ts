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
  itemPrice,
} from './storefrontCatalogHelpers';

/**
 * TC-ECOM-019: a price row that carries only its net side (written outside the catalog price
 * commands, e.g. by direct SQL or a custom importer) is shown on the storefront with the gross amount
 * cart/checkout charge for it. 22.09 net at 5.5% is exactly 23.30495, which rounds half-up to 23.305;
 * float math gives 23.3049.
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
});
