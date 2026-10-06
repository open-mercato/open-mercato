import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { patchOmnibusConfig, runOmnibusBackfillCli } from '../../catalog/__integration__/omnibusHelpers';
import {
  cleanupSecondTenantActor,
  cleanupStorefrontFixture,
  createPriceKindFixture,
  createSecondTenantActor,
  createStorefrontFixture,
  uniqueStamp,
  type SecondTenantActor,
  type StorefrontFixture,
} from './helpers';
import {
  cleanupStorefrontCatalogFixtures,
  createPriceRowFixture,
  createProductFixture,
  createStorefrontFixtureTracker,
  getStorefrontProduct,
  getStorefrontProducts,
  itemPrice,
  type StorefrontPriceBody,
} from './storefrontCatalogHelpers';

/**
 * TC-ECOM-013: promotions are presented only with an Omnibus reference price.
 * Source: .ai/specs/2026-08-14-storefront-public-api.md (rev 4) §12 "Buyer-dependent pricing"
 * (`lowestPriorAmount` present on promotional items, R7), §6.1 and the pricing-engine D2a
 * amendment (promotional kinds overlay the buyer's price kind).
 *
 * The Omnibus configuration is tenant-wide, so the scenario runs in a fresh tenant with two stores:
 * one whose channel is mapped to an enabled EU country, and one whose channel is not mapped. Both
 * sell the same product with a regular and a promotional row; the promotional row wins on both,
 * but only the EU store may present it as a promotion (with the lowest prior price and the
 * struck-through original). The other store charges the same promotional amount without the
 * promotion presentation.
 */
const TENANT_FEATURES = ['ecommerce.*', 'sales.*', 'catalog.*', 'customer_accounts.*'];
const REGULAR_GROSS = 100;
const PROMOTION_GROSS = 80;

test.describe('TC-ECOM-013: storefront promotion presentation and Omnibus', () => {
  test.describe.configure({ timeout: 240_000 });

  test('a promotion is presented only where Omnibus supplies the lowest prior price', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = uniqueStamp();
    const tracker = createStorefrontFixtureTracker();
    let actor: SecondTenantActor | null = null;
    let euStore: StorefrontFixture | null = null;
    let otherStore: StorefrontFixture | null = null;
    try {
      actor = await createSecondTenantActor(request, superadminToken, stamp, TENANT_FEATURES);
      const token = actor.token;
      const regularKindId = await createPriceKindFixture(request, token, {
        stamp,
        suffix: 'regular',
        displayMode: 'including-tax',
      });
      tracker.priceKindIds.push(regularKindId);
      const saleKindId = await createPriceKindFixture(request, token, {
        stamp,
        suffix: 'sale',
        displayMode: 'including-tax',
        isPromotion: true,
      });
      tracker.priceKindIds.push(saleKindId);

      euStore = await createStorefrontFixture(request, token, { stamp: `${stamp}-eu`, channelPriceKindId: regularKindId });
      otherStore = await createStorefrontFixture(request, token, {
        stamp: `${stamp}-other`,
        channelPriceKindId: regularKindId,
      });
      const handle = `qa-ecom-013-${stamp}`;
      const productId = await createProductFixture(request, token, tracker, {
        title: `QA ECOM 013 Promotion ${stamp}`,
        handle,
        sku: `QA-ECOM-013-${stamp}`,
      });
      for (const channelId of [euStore.salesChannelId, otherStore.salesChannelId]) {
        await createPriceRowFixture(request, token, tracker, {
          productId,
          priceKindId: regularKindId,
          channelId,
          taxRate: 25,
          unitPriceNet: 80,
          unitPriceGross: REGULAR_GROSS,
        });
        await createPriceRowFixture(request, token, tracker, {
          productId,
          priceKindId: saleKindId,
          channelId,
          taxRate: 25,
          unitPriceNet: 64,
          unitPriceGross: PROMOTION_GROSS,
        });
      }

      const backfillOutput = runOmnibusBackfillCli({ tenantId: actor.tenantId, channelId: euStore.salesChannelId });
      expect(backfillOutput).toContain('[omnibus:backfill] Complete');
      const enabled = await patchOmnibusConfig(request, token, {
        enabled: true,
        enabledCountryCodes: ['PL'],
        lookbackDays: 30,
        channels: { [euStore.salesChannelId]: { presentedPriceKindId: regularKindId, countryCode: 'PL' } },
      });
      expect(enabled.status, JSON.stringify(enabled.body)).toBe(200);

      const presented: Partial<StorefrontPriceBody> = {
        amount: PROMOTION_GROSS,
        displayMode: 'gross',
        isPromotion: true,
        originalAmount: REGULAR_GROSS,
        lowestPriorAmount: REGULAR_GROSS,
      };
      const notPresented: Partial<StorefrontPriceBody> = {
        amount: PROMOTION_GROSS,
        displayMode: 'gross',
        isPromotion: false,
        originalAmount: null,
        formattedOriginal: null,
        lowestPriorAmount: null,
        formattedLowestPrior: null,
      };

      const euDetail = await getStorefrontProduct(euStore.hostname, handle);
      expect(euDetail.status, euDetail.text).toBe(200);
      expect(euDetail.detail?.price).toMatchObject(presented);
      expect(euDetail.detail?.price?.formattedLowestPrior).toBeTruthy();
      const euList = await getStorefrontProducts(euStore.hostname);
      expect(euList.status, euList.text).toBe(200);
      expect(itemPrice(euList.list, productId)).toMatchObject(presented);

      const otherDetail = await getStorefrontProduct(otherStore.hostname, handle);
      expect(otherDetail.status, otherDetail.text).toBe(200);
      expect(otherDetail.detail?.price).toMatchObject(notPresented);
      const otherList = await getStorefrontProducts(otherStore.hostname);
      expect(otherList.status, otherList.text).toBe(200);
      expect(itemPrice(otherList.list, productId)).toMatchObject(notPresented);
    } finally {
      if (actor) {
        await cleanupStorefrontCatalogFixtures(request, actor.token, tracker);
        await cleanupStorefrontFixture(request, actor.token, euStore);
        await cleanupStorefrontFixture(request, actor.token, otherStore);
      }
      await cleanupSecondTenantActor(request, superadminToken, actor);
    }
  });
});
