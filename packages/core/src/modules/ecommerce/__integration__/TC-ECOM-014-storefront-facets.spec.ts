import { expect, test, type APIRequestContext } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  cleanupStorefrontFixture,
  createPriceKindFixture,
  createStorefrontFixture,
  uniqueStamp,
  type StorefrontFixture,
} from './helpers';
import {
  cleanupStorefrontCatalogFixtures,
  createB2bGroupFixture,
  createCategoryFixture,
  createCompanyBuyerFixture,
  createPriceRowFixture,
  createProductFixture,
  createStorefrontFixtureTracker,
  createVariantFixture,
  getStorefrontProducts,
  itemIds,
  sortedIds,
  type CompanyBuyer,
  type StorefrontFacetsBody,
  type StorefrontFixtureTracker,
} from './storefrontCatalogHelpers';

/**
 * TC-ECOM-014: storefront listing facets.
 * Source: .ai/specs/2026-08-14-storefront-public-api.md (rev 4) §12 "Facets", §5.3, §5.4, §9.1 and R9.
 *
 * Fixture: the channel binding restricts the store to root category R with children A and B and
 * prices anonymous buyers with an `including-tax` kind. Products P1..P3 sit in A, P4..P5 in B; each
 * carries one variant with a `color` option (A: red, blue, red; B: blue, green). Two B2B groups
 * share the same assortment scope (category A) but price their members with different
 * `excluding-tax` kinds, so they share one count-facet cache entry and never a `priceRange`.
 */

const COLOR = 'color';
const ANONYMOUS_NET = [10, 20, 30, 40, 50];
const FIRST_GROUP_NET = [11, 12, 13];
const SECOND_GROUP_NET = [101, 102, 103];

function withTax(net: number): number {
  return Math.round(net * 123) / 100;
}

function expectPriceRange(
  actual: StorefrontFacetsBody['priceRange'] | undefined,
  expected: { min: number; max: number },
  label: string,
): void {
  expect(actual, label).not.toBeNull();
  expect(actual?.currencyCode, label).toBe('EUR');
  expect(actual?.min, `${label}: min`).toBeCloseTo(expected.min, 4);
  expect(actual?.max, `${label}: max`).toBeCloseTo(expected.max, 4);
}

type FacetFixture = {
  store: StorefrontFixture;
  rootId: string;
  categoryAId: string;
  categoryBId: string;
  productIds: string[];
  firstGroupBuyer: CompanyBuyer;
  secondGroupBuyer: CompanyBuyer;
};

async function createFacetFixture(
  request: APIRequestContext,
  token: string,
  tracker: StorefrontFixtureTracker,
  holder: { store: StorefrontFixture | null },
): Promise<FacetFixture> {
  const stamp = uniqueStamp();
  const regularKindId = await createPriceKindFixture(request, token, { stamp, suffix: 'regular', displayMode: 'including-tax' });
  tracker.priceKindIds.push(regularKindId);
  const firstKindId = await createPriceKindFixture(request, token, { stamp, suffix: 'b2b_one', displayMode: 'excluding-tax' });
  tracker.priceKindIds.push(firstKindId);
  const secondKindId = await createPriceKindFixture(request, token, { stamp, suffix: 'b2b_two', displayMode: 'excluding-tax' });
  tracker.priceKindIds.push(secondKindId);

  const rootId = await createCategoryFixture(request, token, tracker, { name: `QA ECOM 014 Root ${stamp}` });
  const categoryAId = await createCategoryFixture(request, token, tracker, { name: `QA ECOM 014 A ${stamp}`, parentId: rootId });
  const categoryBId = await createCategoryFixture(request, token, tracker, { name: `QA ECOM 014 B ${stamp}`, parentId: rootId });

  const store = await createStorefrontFixture(request, token, {
    stamp,
    channelPriceKindId: regularKindId,
    channelAssortmentScope: { categoryIds: [rootId] },
  });
  holder.store = store;

  const layout: Array<{ categoryId: string; color: string }> = [
    { categoryId: categoryAId, color: 'red' },
    { categoryId: categoryAId, color: 'blue' },
    { categoryId: categoryAId, color: 'red' },
    { categoryId: categoryBId, color: 'blue' },
    { categoryId: categoryBId, color: 'green' },
  ];
  const productIds: string[] = [];
  for (const [index, entry] of layout.entries()) {
    const productId = await createProductFixture(request, token, tracker, {
      title: `QA ECOM 014 Product ${index + 1} ${stamp}`,
      handle: `qa-ecom-014-${index + 1}-${stamp}`,
      sku: `QA-ECOM-014-${index + 1}-${stamp}`,
      categoryIds: [entry.categoryId],
    });
    productIds.push(productId);
    await createVariantFixture(request, token, tracker, {
      productId,
      name: `QA ECOM 014 Variant ${index + 1} ${stamp}`,
      sku: `QA-ECOM-014-V${index + 1}-${stamp}`,
      optionValues: { [COLOR]: entry.color },
    });
    await createPriceRowFixture(request, token, tracker, {
      productId,
      priceKindId: regularKindId,
      channelId: store.salesChannelId,
      unitPriceNet: ANONYMOUS_NET[index],
      unitPriceGross: withTax(ANONYMOUS_NET[index]),
    });
  }

  const sharedScope = { categoryIds: [categoryAId] };
  const firstGroupId = await createB2bGroupFixture(request, token, tracker, {
    stamp,
    label: '014-one',
    priceKindId: firstKindId,
    assortmentScope: sharedScope,
  });
  const secondGroupId = await createB2bGroupFixture(request, token, tracker, {
    stamp,
    label: '014-two',
    priceKindId: secondKindId,
    assortmentScope: sharedScope,
  });
  for (const [index, productId] of productIds.slice(0, 3).entries()) {
    await createPriceRowFixture(request, token, tracker, {
      productId,
      priceKindId: firstKindId,
      customerGroupId: firstGroupId,
      unitPriceNet: FIRST_GROUP_NET[index],
      unitPriceGross: withTax(FIRST_GROUP_NET[index]),
    });
    await createPriceRowFixture(request, token, tracker, {
      productId,
      priceKindId: secondKindId,
      customerGroupId: secondGroupId,
      unitPriceNet: SECOND_GROUP_NET[index],
      unitPriceGross: withTax(SECOND_GROUP_NET[index]),
    });
  }
  const firstGroupBuyer = await createCompanyBuyerFixture(request, token, tracker, { stamp, label: '014-one', groupId: firstGroupId });
  const secondGroupBuyer = await createCompanyBuyerFixture(request, token, tracker, { stamp, label: '014-two', groupId: secondGroupId });

  return { store, rootId, categoryAId, categoryBId, productIds, firstGroupBuyer, secondGroupBuyer };
}

function colorCounts(facets: StorefrontFacetsBody | undefined): Record<string, number> {
  const option = facets?.options.find((entry) => entry.code === COLOR);
  return Object.fromEntries((option?.values ?? []).map((value) => [value.code, value.count]));
}

function categoryCounts(facets: StorefrontFacetsBody | undefined): Map<string, number> {
  return new Map((facets?.categories ?? []).map((entry) => [entry.id, entry.count]));
}

function availabilitySum(facets: StorefrontFacetsBody | undefined): number {
  return (facets?.availability ?? []).reduce((sum, entry) => sum + entry.count, 0);
}

test.describe('TC-ECOM-014: storefront listing facets', () => {
  test.describe.configure({ timeout: 240_000 });

  test('cross-excludes the selected option, counts categories with descendants and pages availability', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const tracker = createStorefrontFixtureTracker();
    const holder: { store: StorefrontFixture | null } = { store: null };
    try {
      const fixture = await createFacetFixture(request, token, tracker, holder);
      const host = fixture.store.hostname;
      const [p1, p2, p3, p4, p5] = fixture.productIds;

      const unfiltered = await getStorefrontProducts(host);
      expect(unfiltered.status, unfiltered.text).toBe(200);
      const all = unfiltered.list?.facets;
      expect(itemIds(unfiltered.list)).toEqual(sortedIds([p1, p2, p3, p4, p5]));
      expect(all?.total).toBe(5);
      expect(colorCounts(all)).toEqual({ red: 2, blue: 2, green: 1 });
      const allCategories = categoryCounts(all);
      expect(allCategories.get(fixture.rootId), 'root counts its descendants').toBe(5);
      expect(allCategories.get(fixture.categoryAId)).toBe(3);
      expect(allCategories.get(fixture.categoryBId)).toBe(2);
      expectPriceRange(all?.priceRange, { min: withTax(10), max: withTax(50) }, 'anonymous gross range');
      expect(all?.availabilityScope).toBe('page');
      expect(availabilitySum(all)).toBe(unfiltered.list?.items.length);

      const red = await getStorefrontProducts(host, { query: { [`options[${COLOR}]`]: 'red' } });
      expect(red.status, red.text).toBe(200);
      expect(itemIds(red.list)).toEqual(sortedIds([p1, p3]));
      expect(red.list?.total).toBe(2);
      expect(red.list?.facets.total).toBe(2);
      expect(colorCounts(red.list?.facets), 'the color facet ignores its own selection').toEqual({ red: 2, blue: 2, green: 1 });
      const redCategories = categoryCounts(red.list?.facets);
      expect(redCategories.get(fixture.rootId)).toBe(2);
      expect(redCategories.get(fixture.categoryAId)).toBe(2);
      expect(redCategories.has(fixture.categoryBId), 'a category emptied by the other filters is omitted').toBe(false);
      expectPriceRange(red.list?.facets.priceRange, { min: withTax(10), max: withTax(30) }, 'red range');

      const inCategoryB = await getStorefrontProducts(host, {
        query: { categoryId: fixture.categoryBId, [`options[${COLOR}]`]: 'blue' },
      });
      expect(inCategoryB.status, inCategoryB.text).toBe(200);
      expect(itemIds(inCategoryB.list)).toEqual([p4]);
      expect(colorCounts(inCategoryB.list?.facets)).toEqual({ blue: 1, green: 1 });
      const bCategories = categoryCounts(inCategoryB.list?.facets);
      expect(bCategories.get(fixture.categoryAId), 'the category facet ignores the category selection').toBe(1);
      expect(bCategories.get(fixture.categoryBId)).toBe(1);

      const inStock = await getStorefrontProducts(host, { query: { availability: 'in_stock', pageSize: '2' } });
      expect(inStock.status, inStock.text).toBe(200);
      expect(inStock.list?.appliedFilters.availability).toEqual({ value: 'in_stock', scope: 'page' });
      expect(inStock.list?.total).toBe(5);
      expect(inStock.list?.totalPages).toBe(3);
      expect(inStock.list?.facets.availabilityScope).toBe('page');
      expect(availabilitySum(inStock.list?.facets), 'availability counts the page before its own filter').toBe(2);
      expect(inStock.list?.items.length ?? 0).toBeLessThanOrEqual(2);
    } finally {
      await cleanupStorefrontCatalogFixtures(request, token, tracker);
      await cleanupStorefrontFixture(request, token, holder.store);
    }
  });

  test('a restricted buyer counts only its assortment and buyers sharing it never share a priceRange', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const tracker = createStorefrontFixtureTracker();
    const holder: { store: StorefrontFixture | null } = { store: null };
    try {
      const fixture = await createFacetFixture(request, token, tracker, holder);
      const host = fixture.store.hostname;
      const [p1, p2, p3] = fixture.productIds;
      const first = { cookie: fixture.firstGroupBuyer.session.cookieHeader };
      const second = { cookie: fixture.secondGroupBuyer.session.cookieHeader };
      const expectations = [
        { label: 'first group', options: first, range: { min: 11, max: 13 } },
        { label: 'second group', options: second, range: { min: 101, max: 103 } },
        { label: 'first group again', options: first, range: { min: 11, max: 13 } },
        { label: 'second group again', options: second, range: { min: 101, max: 103 } },
      ];

      for (const expectation of expectations) {
        const listing = await getStorefrontProducts(host, expectation.options);
        expect(listing.status, `${expectation.label}: ${listing.text}`).toBe(200);
        const facets = listing.list?.facets;
        expect(itemIds(listing.list), expectation.label).toEqual(sortedIds([p1, p2, p3]));
        expect(listing.list?.taxMode, expectation.label).toBe('net');
        expect(facets?.total, expectation.label).toBe(3);
        expect(colorCounts(facets), `${expectation.label}: counts stay inside the assortment`).toEqual({ red: 2, blue: 1 });
        const categories = categoryCounts(facets);
        expect(categories.get(fixture.categoryAId), expectation.label).toBe(3);
        expect(categories.has(fixture.categoryBId), `${expectation.label}: out-of-assortment category`).toBe(false);
        expectPriceRange(facets?.priceRange, expectation.range, `${expectation.label}: priceRange is the buyer's own`);

        const filtered = await getStorefrontProducts(host, { ...expectation.options, query: { [`options[${COLOR}]`]: 'blue' } });
        expect(filtered.status, filtered.text).toBe(200);
        expect(itemIds(filtered.list), expectation.label).toEqual([p2]);
        expect(colorCounts(filtered.list?.facets), expectation.label).toEqual({ red: 2, blue: 1 });
        expectPriceRange(
          filtered.list?.facets.priceRange,
          { min: expectation.range.min + 1, max: expectation.range.min + 1 },
          `${expectation.label}: priceRange covers the filtered set`,
        );
      }

      const anonymous = await getStorefrontProducts(host);
      expect(anonymous.status, anonymous.text).toBe(200);
      expect(colorCounts(anonymous.list?.facets)).toEqual({ red: 2, blue: 2, green: 1 });
      expectPriceRange(anonymous.list?.facets.priceRange, { min: withTax(10), max: withTax(50) }, 'anonymous after buyers');
    } finally {
      await cleanupStorefrontCatalogFixtures(request, token, tracker);
      await cleanupStorefrontFixture(request, token, holder.store);
    }
  });
});
