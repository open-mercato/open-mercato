import { expect, test, type APIRequestContext } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  PRIVATE_CACHE_CONTROL,
  cleanupStorefrontFixture,
  createPriceKindFixture,
  createStorefrontFixture,
  setChannelBindingRequireAuthentication,
  uniqueStamp,
  type StorefrontFixture,
} from './helpers';
import {
  CATEGORY_NOT_FOUND_BODY,
  STOREFRONT_ERROR_CACHE_CONTROL,
  cleanupStorefrontCatalogFixtures,
  createB2bGroupFixture,
  createCategoryFixture,
  createCompanyBuyerFixture,
  createPriceRowFixture,
  createProductFixture,
  createStorefrontFixtureTracker,
  flattenCategoryTree,
  getStorefrontCategoryLanding,
  getStorefrontCategoryTree,
  getStorefrontProducts,
  itemIds,
  sortedIds,
  type CompanyBuyer,
  type StorefrontFixtureTracker,
} from './storefrontCatalogHelpers';

/**
 * TC-ECOM-015: storefront category tree and category landing.
 * Source: .ai/specs/2026-08-14-storefront-public-api.md (rev 4) §4.3, §4.4, §12 "Assortment and
 * isolation" (channel ∩ group scope applied to category counts, R9) and the
 * `require_authentication` deny-all assortment (buyer-scoped catalog visibility §3.4).
 *
 * Fixture: the channel binding restricts the store to root R. R holds A (with child A1), B, an
 * empty E, and an inactive C with an active child D. P1 sits in A1, P2 in A, P3 in B. A B2B group
 * narrows its members to A.
 */

const TREE_ANONYMOUS_CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=60';
const LANDING_ANONYMOUS_CACHE_CONTROL = 'public, max-age=30, stale-while-revalidate=30';

type CategoryRef = { id: string; slug: string };

type CategoryFixture = {
  store: StorefrontFixture;
  root: CategoryRef;
  categoryA: CategoryRef;
  categoryA1: CategoryRef;
  categoryB: CategoryRef;
  emptyCategory: CategoryRef;
  inactiveCategory: CategoryRef;
  underInactive: CategoryRef;
  productIds: { p1: string; p2: string; p3: string };
  groupBuyer: CompanyBuyer;
};

async function createCategoryTreeFixture(
  request: APIRequestContext,
  token: string,
  tracker: StorefrontFixtureTracker,
  holder: { store: StorefrontFixture | null },
): Promise<CategoryFixture> {
  const stamp = uniqueStamp();
  const slugStamp = stamp.toLowerCase();
  const priceKindId = await createPriceKindFixture(request, token, { stamp, suffix: 'regular', displayMode: 'including-tax' });
  tracker.priceKindIds.push(priceKindId);

  const category = async (label: string, parentId: string | null, isActive = true): Promise<CategoryRef> => {
    const slug = `qa-ecom-015-${label}-${slugStamp}`;
    const id = await createCategoryFixture(request, token, tracker, {
      name: `QA ECOM 015 ${label.toUpperCase()} ${stamp}`,
      parentId,
      slug,
      isActive,
    });
    return { id, slug };
  };
  const root = await category('root', null);
  const categoryA = await category('a', root.id);
  const categoryA1 = await category('a1', categoryA.id);
  const categoryB = await category('b', root.id);
  const emptyCategory = await category('empty', root.id);
  const inactiveCategory = await category('inactive', root.id, false);
  const underInactive = await category('under-inactive', inactiveCategory.id);

  const store = await createStorefrontFixture(request, token, {
    stamp,
    channelPriceKindId: priceKindId,
    channelAssortmentScope: { categoryIds: [root.id] },
  });
  holder.store = store;

  const product = async (label: string, categoryId: string): Promise<string> => {
    const productId = await createProductFixture(request, token, tracker, {
      title: `QA ECOM 015 ${label} ${stamp}`,
      handle: `qa-ecom-015-${label}-${slugStamp}`,
      sku: `QA-ECOM-015-${label}-${stamp}`,
      categoryIds: [categoryId],
    });
    await createPriceRowFixture(request, token, tracker, {
      productId,
      priceKindId,
      channelId: store.salesChannelId,
      unitPriceNet: 100,
      unitPriceGross: 123,
    });
    return productId;
  };
  const p1 = await product('p1', categoryA1.id);
  const p2 = await product('p2', categoryA.id);
  const p3 = await product('p3', categoryB.id);

  const groupId = await createB2bGroupFixture(request, token, tracker, {
    stamp,
    label: '015',
    priceKindId,
    assortmentScope: { categoryIds: [categoryA.id] },
  });
  const groupBuyer = await createCompanyBuyerFixture(request, token, tracker, { stamp, label: '015', groupId });

  return {
    store,
    root,
    categoryA,
    categoryA1,
    categoryB,
    emptyCategory,
    inactiveCategory,
    underInactive,
    productIds: { p1, p2, p3 },
    groupBuyer,
  };
}

test.describe('TC-ECOM-015: storefront categories', () => {
  test.describe.configure({ timeout: 240_000 });

  test('the tree counts products with descendants inside each buyer\'s assortment', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const tracker = createStorefrontFixtureTracker();
    const holder: { store: StorefrontFixture | null } = { store: null };
    try {
      const fixture = await createCategoryTreeFixture(request, token, tracker, holder);
      const host = fixture.store.hostname;

      const anonymous = await getStorefrontCategoryTree(host);
      expect(anonymous.status, anonymous.text).toBe(200);
      expect(anonymous.headers['cache-control']).toBe(TREE_ANONYMOUS_CACHE_CONTROL);
      expect(anonymous.categories?.tree.map((node) => node.id), 'only the channel scope is reachable').toEqual([fixture.root.id]);
      const anonymousNodes = flattenCategoryTree(anonymous.categories?.tree ?? []);
      expect(sortedIds(anonymousNodes.keys())).toEqual(
        sortedIds([fixture.root.id, fixture.categoryA.id, fixture.categoryA1.id, fixture.categoryB.id]),
      );
      expect(anonymousNodes.get(fixture.root.id)?.productCount).toBe(3);
      expect(anonymousNodes.get(fixture.categoryA.id)?.productCount).toBe(2);
      expect(anonymousNodes.get(fixture.categoryA1.id)?.productCount).toBe(1);
      expect(anonymousNodes.get(fixture.categoryB.id)?.productCount).toBe(1);
      expect(anonymousNodes.get(fixture.categoryA1.id)?.parentId).toBe(fixture.categoryA.id);

      const withEmpty = await getStorefrontCategoryTree(host, { query: { includeEmpty: 'true' } });
      expect(withEmpty.status, withEmpty.text).toBe(200);
      const withEmptyNodes = flattenCategoryTree(withEmpty.categories?.tree ?? []);
      expect(withEmptyNodes.get(fixture.emptyCategory.id)?.productCount).toBe(0);
      expect(withEmptyNodes.has(fixture.inactiveCategory.id), 'an inactive category is never listed').toBe(false);
      expect(withEmptyNodes.has(fixture.underInactive.id), 'a child of an inactive category is unreachable').toBe(false);

      const shallow = await getStorefrontCategoryTree(host, { query: { depth: '1' } });
      expect(shallow.status, shallow.text).toBe(200);
      expect(shallow.categories?.tree[0]?.children).toEqual([]);
      expect(shallow.categories?.tree[0]?.hasChildren).toBe(true);

      const group = await getStorefrontCategoryTree(host, { cookie: fixture.groupBuyer.session.cookieHeader });
      expect(group.status, group.text).toBe(200);
      expect(group.headers['cache-control']).toBe(PRIVATE_CACHE_CONTROL);
      const groupNodes = flattenCategoryTree(group.categories?.tree ?? []);
      expect(groupNodes.has(fixture.categoryB.id), 'out-of-assortment category').toBe(false);
      expect(groupNodes.get(fixture.categoryA.id)?.productCount).toBe(2);
      expect(groupNodes.get(fixture.categoryA1.id)?.productCount).toBe(1);
      expect(groupNodes.get(fixture.root.id)?.productCount, 'the parent counts only the visible subtree').toBe(2);
    } finally {
      await cleanupStorefrontCatalogFixtures(request, token, tracker);
      await cleanupStorefrontFixture(request, token, holder.store);
    }
  });

  test('the landing embeds the filtered listing and hidden slugs share one 404', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const tracker = createStorefrontFixtureTracker();
    const holder: { store: StorefrontFixture | null } = { store: null };
    try {
      const fixture = await createCategoryTreeFixture(request, token, tracker, holder);
      const host = fixture.store.hostname;
      const { p1, p2 } = fixture.productIds;

      const landing = await getStorefrontCategoryLanding(host, fixture.categoryA.slug);
      expect(landing.status, landing.text).toBe(200);
      expect(landing.headers['cache-control']).toBe(LANDING_ANONYMOUS_CACHE_CONTROL);
      const category = landing.landing?.category;
      expect(category?.id).toBe(fixture.categoryA.id);
      expect(category?.productCount).toBe(2);
      expect(category?.ancestorIds).toEqual([fixture.root.id]);
      expect(category?.breadcrumb.map((entry) => entry.id)).toEqual([fixture.root.id, fixture.categoryA.id]);
      expect(category?.children.map((child) => ({ id: child.id, productCount: child.productCount }))).toEqual([
        { id: fixture.categoryA1.id, productCount: 1 },
      ]);
      expect(itemIds(landing.landing?.products ?? null)).toEqual(sortedIds([p1, p2]));
      expect(landing.landing?.products.total).toBe(2);

      const listing = await getStorefrontProducts(host, { query: { categoryId: fixture.categoryA.id } });
      expect(listing.status, listing.text).toBe(200);
      expect(landing.landing?.products, 'the landing embeds GET /products?categoryId=').toEqual(listing.body);

      const narrowed = await getStorefrontCategoryLanding(host, fixture.categoryA.slug, { query: { search: 'p1' } });
      expect(narrowed.status, narrowed.text).toBe(200);
      expect(itemIds(narrowed.landing?.products ?? null)).toEqual([p1]);

      const rejected = await getStorefrontCategoryLanding(host, fixture.categoryA.slug, {
        query: { categoryId: fixture.categoryB.id },
      });
      expect(rejected.status, rejected.text).toBe(400);

      const groupCookie = fixture.groupBuyer.session.cookieHeader;
      const groupLanding = await getStorefrontCategoryLanding(host, fixture.categoryA.slug, { cookie: groupCookie });
      expect(groupLanding.status, groupLanding.text).toBe(200);
      expect(groupLanding.headers['cache-control']).toBe(PRIVATE_CACHE_CONTROL);
      expect(itemIds(groupLanding.landing?.products ?? null)).toEqual(sortedIds([p1, p2]));

      const hidden = [
        { label: 'out of the buyer\'s assortment', slug: fixture.categoryB.slug, cookie: groupCookie },
        { label: 'inactive', slug: fixture.inactiveCategory.slug },
        { label: 'under an inactive ancestor', slug: fixture.underInactive.slug },
        { label: 'nonexistent', slug: `qa-ecom-015-missing-${fixture.store.stamp.toLowerCase()}` },
      ];
      const texts = new Set<string>();
      for (const entry of hidden) {
        const response = await getStorefrontCategoryLanding(host, entry.slug, { cookie: entry.cookie });
        expect(response.status, `${entry.label}: ${response.text}`).toBe(404);
        expect(response.body, entry.label).toEqual(CATEGORY_NOT_FOUND_BODY);
        expect(response.headers['cache-control'], entry.label).toBe(STOREFRONT_ERROR_CACHE_CONTROL);
        texts.add(response.text);
      }
      expect(texts.size, 'every hidden slug answers byte-identically').toBe(1);

      const visibleToAnonymous = await getStorefrontCategoryLanding(host, fixture.categoryB.slug);
      expect(visibleToAnonymous.status, visibleToAnonymous.text).toBe(200);
    } finally {
      await cleanupStorefrontCatalogFixtures(request, token, tracker);
      await cleanupStorefrontFixture(request, token, holder.store);
    }
  });

  test('a closed require_authentication channel serves anonymous buyers an empty tree and 404 landings', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const tracker = createStorefrontFixtureTracker();
    const holder: { store: StorefrontFixture | null } = { store: null };
    try {
      const fixture = await createCategoryTreeFixture(request, token, tracker, holder);
      const host = fixture.store.hostname;

      const open = await getStorefrontCategoryTree(host);
      expect(open.status, open.text).toBe(200);
      expect(open.categories?.tree.length).toBe(1);

      await setChannelBindingRequireAuthentication(request, token, fixture.store.channelBindingId as string, true);

      const closed = await getStorefrontCategoryTree(host);
      expect(closed.status, closed.text).toBe(200);
      expect(closed.categories?.tree).toEqual([]);
      const closedLanding = await getStorefrontCategoryLanding(host, fixture.categoryA.slug);
      expect(closedLanding.status, closedLanding.text).toBe(404);
      expect(closedLanding.body).toEqual(CATEGORY_NOT_FOUND_BODY);

      const buyer = await createCompanyBuyerFixture(request, token, tracker, { stamp: fixture.store.stamp, label: '015-closed' });
      const buyerTree = await getStorefrontCategoryTree(host, { cookie: buyer.session.cookieHeader });
      expect(buyerTree.status, buyerTree.text).toBe(200);
      expect(flattenCategoryTree(buyerTree.categories?.tree ?? []).get(fixture.root.id)?.productCount).toBe(3);
      const buyerLanding = await getStorefrontCategoryLanding(host, fixture.categoryA.slug, { cookie: buyer.session.cookieHeader });
      expect(buyerLanding.status, buyerLanding.text).toBe(200);
      expect(buyerLanding.landing?.category.productCount).toBe(2);
    } finally {
      await cleanupStorefrontCatalogFixtures(request, token, tracker);
      await cleanupStorefrontFixture(request, token, holder.store);
    }
  });
});
