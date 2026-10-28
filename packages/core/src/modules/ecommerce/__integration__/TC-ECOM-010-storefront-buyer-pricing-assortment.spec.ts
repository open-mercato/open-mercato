import { expect, test, type APIRequestContext } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  PRIVATE_CACHE_CONTROL,
  cleanupStorefrontFixture,
  createPriceKindFixture,
  createStorefrontFixture,
  uniqueStamp,
  type StorefrontFixture,
} from './helpers';
import {
  DETAIL_ANONYMOUS_CACHE_CONTROL,
  LISTING_ANONYMOUS_CACHE_CONTROL,
  PRODUCT_NOT_FOUND_BODY,
  STOREFRONT_ERROR_CACHE_CONTROL,
  cleanupStorefrontCatalogFixtures,
  createB2bGroupFixture,
  createCategoryFixture,
  createCompanyBuyerFixture,
  createPriceRowFixture,
  createProductFixture,
  createStorefrontFixtureTracker,
  getStorefrontProduct,
  getStorefrontProducts,
  itemIds,
  itemPrice,
  type CompanyBuyer,
  type StorefrontFixtureTracker,
} from './storefrontCatalogHelpers';

/**
 * TC-ECOM-010: buyer-dependent pricing and assortment on the public product endpoints.
 * Source: .ai/specs/2026-08-14-storefront-public-api.md (rev 4) §12 "Assortment and isolation" and
 * "Buyer-dependent pricing", §13 Phase 1 gate; release acceptance "anonymous and authenticated B2B
 * requests to the same product URL return correctly different prices and assortment, zero cache
 * bleed between buyer contexts".
 *
 * Fixture: the channel binding restricts the store to one root category and prices anonymous
 * buyers with an `including-tax` kind. A B2B group's terms switch its members to an
 * `excluding-tax` kind and narrow the assortment to one child category. Product A (in that child)
 * has a channel row, a group row and one company's contract row; product B (in the sibling child)
 * is visible anonymously but outside the group's assortment.
 */

type PricingFixture = {
  store: StorefrontFixture;
  productA: { id: string; handle: string };
  productB: { id: string; handle: string };
  contractBuyer: CompanyBuyer;
  groupBuyer: CompanyBuyer;
  secondGroupBuyer: CompanyBuyer;
};

const ANONYMOUS_PRICE_A = 123;
const ANONYMOUS_PRICE_B = 61.5;
const GROUP_PRICE_A = 80;
const CONTRACT_PRICE_A = 70;

async function createPricingFixture(
  request: APIRequestContext,
  token: string,
  tracker: StorefrontFixtureTracker,
  holder: { store: StorefrontFixture | null },
): Promise<PricingFixture> {
  const stamp = uniqueStamp();
  const regularKindId = await createPriceKindFixture(request, token, {
    stamp,
    suffix: 'regular',
    displayMode: 'including-tax',
  });
  tracker.priceKindIds.push(regularKindId);
  const b2bKindId = await createPriceKindFixture(request, token, { stamp, suffix: 'b2b', displayMode: 'excluding-tax' });
  tracker.priceKindIds.push(b2bKindId);

  const rootId = await createCategoryFixture(request, token, tracker, { name: `QA ECOM 010 Root ${stamp}` });
  const contractCategoryId = await createCategoryFixture(request, token, tracker, {
    name: `QA ECOM 010 Contract ${stamp}`,
    parentId: rootId,
  });
  const retailCategoryId = await createCategoryFixture(request, token, tracker, {
    name: `QA ECOM 010 Retail ${stamp}`,
    parentId: rootId,
  });

  const store = await createStorefrontFixture(request, token, {
    stamp,
    channelPriceKindId: regularKindId,
    channelAssortmentScope: { categoryIds: [rootId] },
  });
  holder.store = store;

  const handleA = `qa-ecom-010-a-${stamp}`;
  const productAId = await createProductFixture(request, token, tracker, {
    title: `QA ECOM 010 Contract Product ${stamp}`,
    handle: handleA,
    sku: `QA-ECOM-010-A-${stamp}`,
    categoryIds: [contractCategoryId],
  });
  const handleB = `qa-ecom-010-b-${stamp}`;
  const productBId = await createProductFixture(request, token, tracker, {
    title: `QA ECOM 010 Retail Product ${stamp}`,
    handle: handleB,
    sku: `QA-ECOM-010-B-${stamp}`,
    categoryIds: [retailCategoryId],
  });

  const groupId = await createB2bGroupFixture(request, token, tracker, {
    stamp,
    label: '010',
    priceKindId: b2bKindId,
    assortmentScope: { categoryIds: [contractCategoryId] },
  });
  const contractBuyer = await createCompanyBuyerFixture(request, token, tracker, { stamp, label: 'contract', groupId });
  const groupBuyer = await createCompanyBuyerFixture(request, token, tracker, { stamp, label: 'group', groupId });
  const secondGroupBuyer = await createCompanyBuyerFixture(request, token, tracker, { stamp, label: 'group-2', groupId });

  await createPriceRowFixture(request, token, tracker, {
    productId: productAId,
    priceKindId: regularKindId,
    channelId: store.salesChannelId,
    unitPriceNet: 100,
    unitPriceGross: ANONYMOUS_PRICE_A,
  });
  await createPriceRowFixture(request, token, tracker, {
    productId: productAId,
    priceKindId: b2bKindId,
    customerGroupId: groupId,
    unitPriceNet: GROUP_PRICE_A,
    unitPriceGross: 98.4,
  });
  await createPriceRowFixture(request, token, tracker, {
    productId: productAId,
    priceKindId: b2bKindId,
    customerId: contractBuyer.companyId,
    unitPriceNet: CONTRACT_PRICE_A,
    unitPriceGross: 86.1,
  });
  await createPriceRowFixture(request, token, tracker, {
    productId: productBId,
    priceKindId: regularKindId,
    channelId: store.salesChannelId,
    unitPriceNet: 50,
    unitPriceGross: ANONYMOUS_PRICE_B,
  });
  await createPriceRowFixture(request, token, tracker, {
    productId: productBId,
    priceKindId: b2bKindId,
    customerGroupId: groupId,
    unitPriceNet: 40,
    unitPriceGross: 49.2,
  });

  return {
    store,
    productA: { id: productAId, handle: handleA },
    productB: { id: productBId, handle: handleB },
    contractBuyer,
    groupBuyer,
    secondGroupBuyer,
  };
}

test.describe('TC-ECOM-010: storefront buyer-dependent pricing and assortment', () => {
  test.describe.configure({ timeout: 180_000 });

  test('the same product URL serves anonymous and B2B buyers different prices and assortment', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const tracker = createStorefrontFixtureTracker();
    const holder: { store: StorefrontFixture | null } = { store: null };
    try {
      const fixture = await createPricingFixture(request, token, tracker, holder);
      const host = fixture.store.hostname;
      const groupCookie = fixture.groupBuyer.session.cookieHeader;

      const anonymousA = await getStorefrontProduct(host, fixture.productA.handle);
      expect(anonymousA.status, anonymousA.text).toBe(200);
      expect(anonymousA.headers['cache-control']).toBe(DETAIL_ANONYMOUS_CACHE_CONTROL);
      expect(anonymousA.detail?.id).toBe(fixture.productA.id);
      expect(anonymousA.detail?.price).toMatchObject({ amount: ANONYMOUS_PRICE_A, displayMode: 'gross', currencyCode: 'EUR' });

      const b2bA = await getStorefrontProduct(host, fixture.productA.handle, { cookie: groupCookie });
      expect(b2bA.status, b2bA.text).toBe(200);
      expect(b2bA.headers['cache-control']).toBe(PRIVATE_CACHE_CONTROL);
      expect(b2bA.detail?.id).toBe(fixture.productA.id);
      expect(b2bA.detail?.price).toMatchObject({ amount: GROUP_PRICE_A, displayMode: 'net', currencyCode: 'EUR' });

      const anonymousB = await getStorefrontProduct(host, fixture.productB.handle);
      expect(anonymousB.status, anonymousB.text).toBe(200);
      expect(anonymousB.detail?.price).toMatchObject({ amount: ANONYMOUS_PRICE_B, displayMode: 'gross' });

      for (const idOrHandle of [fixture.productB.handle, fixture.productB.id]) {
        const b2bB = await getStorefrontProduct(host, idOrHandle, { cookie: groupCookie });
        expect(b2bB.status, b2bB.text).toBe(404);
        expect(b2bB.body).toEqual(PRODUCT_NOT_FOUND_BODY);
        expect(b2bB.headers['cache-control']).toBe(STOREFRONT_ERROR_CACHE_CONTROL);
      }

      const anonymousList = await getStorefrontProducts(host);
      expect(anonymousList.status, anonymousList.text).toBe(200);
      expect(anonymousList.headers['cache-control']).toBe(LISTING_ANONYMOUS_CACHE_CONTROL);
      expect(itemIds(anonymousList.list)).toEqual([fixture.productA.id, fixture.productB.id].sort());
      expect(anonymousList.list?.taxMode).toBe('gross');
      expect(anonymousList.list?.total).toBe(2);
      expect(itemPrice(anonymousList.list, fixture.productA.id)?.amount).toBe(ANONYMOUS_PRICE_A);
      expect(itemPrice(anonymousList.list, fixture.productB.id)?.amount).toBe(ANONYMOUS_PRICE_B);

      const b2bList = await getStorefrontProducts(host, { cookie: groupCookie });
      expect(b2bList.status, b2bList.text).toBe(200);
      expect(b2bList.headers['cache-control']).toBe(PRIVATE_CACHE_CONTROL);
      expect(itemIds(b2bList.list)).toEqual([fixture.productA.id]);
      expect(b2bList.list?.taxMode).toBe('net');
      expect(b2bList.list?.total).toBe(1);
      expect(itemPrice(b2bList.list, fixture.productA.id)).toMatchObject({ amount: GROUP_PRICE_A, displayMode: 'net' });
    } finally {
      await cleanupStorefrontCatalogFixtures(request, token, tracker);
      await cleanupStorefrontFixture(request, token, holder.store);
    }
  });

  test('interleaved buyer contexts never receive another context\'s cached listing or detail', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const tracker = createStorefrontFixtureTracker();
    const holder: { store: StorefrontFixture | null } = { store: null };
    try {
      const fixture = await createPricingFixture(request, token, tracker, holder);
      const host = fixture.store.hostname;
      type Caller = { label: string; cookie?: string; ids: string[]; priceA: number; taxMode: 'gross' | 'net' };
      const anonymous: Caller = {
        label: 'anonymous',
        ids: [fixture.productA.id, fixture.productB.id].sort(),
        priceA: ANONYMOUS_PRICE_A,
        taxMode: 'gross',
      };
      const group: Caller = {
        label: 'group',
        cookie: fixture.groupBuyer.session.cookieHeader,
        ids: [fixture.productA.id],
        priceA: GROUP_PRICE_A,
        taxMode: 'net',
      };
      const contract: Caller = {
        label: 'contract',
        cookie: fixture.contractBuyer.session.cookieHeader,
        ids: [fixture.productA.id],
        priceA: CONTRACT_PRICE_A,
        taxMode: 'net',
      };
      const query = { sort: 'title_asc', pageSize: '24' };

      for (const caller of [anonymous, group, contract, anonymous, contract, group, anonymous, group]) {
        const listing = await getStorefrontProducts(host, { query, cookie: caller.cookie });
        expect(listing.status, `${caller.label}: ${listing.text}`).toBe(200);
        expect(listing.headers['cache-control'], caller.label).toBe(
          caller.cookie ? PRIVATE_CACHE_CONTROL : LISTING_ANONYMOUS_CACHE_CONTROL,
        );
        expect(itemIds(listing.list), caller.label).toEqual(caller.ids);
        expect(listing.list?.taxMode, caller.label).toBe(caller.taxMode);
        expect(itemPrice(listing.list, fixture.productA.id)?.amount, caller.label).toBe(caller.priceA);

        const detail = await getStorefrontProduct(host, fixture.productA.handle, { cookie: caller.cookie });
        expect(detail.status, `${caller.label}: ${detail.text}`).toBe(200);
        expect(detail.headers['cache-control'], caller.label).toBe(
          caller.cookie ? PRIVATE_CACHE_CONTROL : DETAIL_ANONYMOUS_CACHE_CONTROL,
        );
        expect(detail.detail?.price?.amount, caller.label).toBe(caller.priceA);
        expect(detail.detail?.price?.displayMode, caller.label).toBe(caller.taxMode);
      }
    } finally {
      await cleanupStorefrontCatalogFixtures(request, token, tracker);
      await cleanupStorefrontFixture(request, token, holder.store);
    }
  });

  test('a personal contract row wins over the group price for its customer only', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const tracker = createStorefrontFixtureTracker();
    const holder: { store: StorefrontFixture | null } = { store: null };
    try {
      const fixture = await createPricingFixture(request, token, tracker, holder);
      const host = fixture.store.hostname;

      const contractDetail = await getStorefrontProduct(host, fixture.productA.handle, {
        cookie: fixture.contractBuyer.session.cookieHeader,
      });
      expect(contractDetail.status, contractDetail.text).toBe(200);
      expect(contractDetail.detail?.price).toMatchObject({ amount: CONTRACT_PRICE_A, displayMode: 'net' });

      const groupDetail = await getStorefrontProduct(host, fixture.productA.handle, {
        cookie: fixture.groupBuyer.session.cookieHeader,
      });
      const secondGroupDetail = await getStorefrontProduct(host, fixture.productA.handle, {
        cookie: fixture.secondGroupBuyer.session.cookieHeader,
      });
      expect(groupDetail.status, groupDetail.text).toBe(200);
      expect(secondGroupDetail.status, secondGroupDetail.text).toBe(200);
      expect(groupDetail.detail?.price).toMatchObject({ amount: GROUP_PRICE_A, displayMode: 'net' });
      expect(secondGroupDetail.detail?.price).toEqual(groupDetail.detail?.price);

      const groupList = await getStorefrontProducts(host, { cookie: fixture.groupBuyer.session.cookieHeader });
      const secondGroupList = await getStorefrontProducts(host, { cookie: fixture.secondGroupBuyer.session.cookieHeader });
      expect(groupList.status, groupList.text).toBe(200);
      expect(secondGroupList.status, secondGroupList.text).toBe(200);
      expect(secondGroupList.body, 'two group members without contract rows see the same listing').toEqual(groupList.body);

      const contractList = await getStorefrontProducts(host, { cookie: fixture.contractBuyer.session.cookieHeader });
      expect(contractList.status, contractList.text).toBe(200);
      expect(itemPrice(contractList.list, fixture.productA.id)?.amount).toBe(CONTRACT_PRICE_A);
      expect(itemPrice(groupList.list, fixture.productA.id)?.amount).toBe(GROUP_PRICE_A);

      const anonymousDetail = await getStorefrontProduct(host, fixture.productA.handle);
      expect(anonymousDetail.detail?.price?.amount).toBe(ANONYMOUS_PRICE_A);
    } finally {
      await cleanupStorefrontCatalogFixtures(request, token, tracker);
      await cleanupStorefrontFixture(request, token, holder.store);
    }
  });
});
