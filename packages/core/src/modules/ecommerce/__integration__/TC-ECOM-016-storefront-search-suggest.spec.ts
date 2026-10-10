import { randomInt } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';
import {
  PRIVATE_CACHE_CONTROL,
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
  getStorefrontSearchSuggest,
  sortedIds,
  type CompanyBuyer,
  type StorefrontFixtureTracker,
  type StorefrontSearchSuggestBody,
} from './storefrontCatalogHelpers';

/**
 * TC-ECOM-016: storefront search suggest.
 * Source: .ai/specs/2026-08-14-storefront-public-api.md (rev 4) §4.5, §8, §12 "Search" and R14.
 *
 * Fixture: the channel binding restricts the store to root R with children In and Out; a B2B
 * group narrows its members to In. Ten In products carry the marker word M in their title, twelve
 * Out products carry M followed by a second marker word N, and one inactive In product carries M.
 *
 * Backend selection is the server's (`OM_ECOMMERCE_STOREFRONT_SEARCH`, default `auto`: `tokens`,
 * then `pgvector`, then `ILIKE`). A term of two characters never tokenizes, so it is answered by
 * `pgvector` or `ILIKE`; the full marker is answered by `tokens` whenever the strategy is
 * registered. Which one served the marker is observed rather than assumed: `tokens` indexes word
 * prefixes, so an infix of M finds nothing there while `ILIKE` and `pgvector` still match it.
 *
 * Starvation (R14): with `tokens`, Out products match every hash of "M N" and In products only
 * those of M, so the unrestricted top-k for "M N" is all Out products — asserted for the anonymous
 * buyer. A restricted buyer must still receive a full page of In products, which holds only when
 * the scope predicate is part of the ranking query.
 */

const IN_SCOPE_COUNT = 10;
const OUT_OF_SCOPE_COUNT = 12;
const SUGGEST_LIMIT = 8;
const TOKEN_INDEX_TIMEOUT_MS = 60_000;
const MARKER_ALPHABET = 'bcdfghjkmnpqrstvwxz';
const SUGGEST_RESPONSE_KEYS = ['categories', 'effectiveLocale', 'products', 'suggestions'];
const SUGGEST_PRODUCT_KEYS = ['defaultMediaUrl', 'formattedPrice', 'handle', 'id', 'title'];

type SearchFixture = {
  store: StorefrontFixture;
  marker: string;
  secondMarker: string;
  inCategoryId: string;
  outCategoryId: string;
  inScopeIds: string[];
  outOfScopeIds: string[];
  inactiveId: string;
  groupBuyer: CompanyBuyer;
  tokensIndexed: boolean;
};

function randomMarker(prefix: string, length: number): string {
  let marker = prefix;
  while (marker.length < length) marker += MARKER_ALPHABET[randomInt(MARKER_ALPHABET.length)];
  return marker;
}

async function waitForSearchTokens(productIds: string[]): Promise<boolean> {
  const deadline = Date.now() + TOKEN_INDEX_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const indexed = await withClient(async (client) => {
      const result = await client.query<{ indexed: string }>(
        `select count(distinct entity_id) as indexed
           from search_tokens
          where entity_type = 'catalog:catalog_product'
            and entity_id = any($1::text[])`,
        [productIds],
      );
      return Number(result.rows[0]?.indexed ?? 0);
    });
    if (indexed >= productIds.length) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function createSearchFixture(
  request: APIRequestContext,
  token: string,
  tracker: StorefrontFixtureTracker,
  holder: { store: StorefrontFixture | null },
): Promise<SearchFixture> {
  const stamp = uniqueStamp();
  const marker = randomMarker('qzv', 12);
  const secondMarker = randomMarker('kwj', 8);
  const priceKindId = await createPriceKindFixture(request, token, { stamp, suffix: 'regular', displayMode: 'including-tax' });
  tracker.priceKindIds.push(priceKindId);

  const rootId = await createCategoryFixture(request, token, tracker, { name: `QA ECOM 016 Root ${stamp}` });
  const inCategoryId = await createCategoryFixture(request, token, tracker, {
    name: `QA ECOM 016 In ${marker}`,
    parentId: rootId,
  });
  const outCategoryId = await createCategoryFixture(request, token, tracker, {
    name: `QA ECOM 016 Out ${marker}`,
    parentId: rootId,
  });

  const store = await createStorefrontFixture(request, token, {
    stamp,
    channelPriceKindId: priceKindId,
    channelAssortmentScope: { categoryIds: [rootId] },
  });
  holder.store = store;

  const inScopeIds: string[] = [];
  for (let index = 1; index <= IN_SCOPE_COUNT; index += 1) {
    const productId = await createProductFixture(request, token, tracker, {
      title: `QA ECOM 016 In ${index} ${marker}`,
      handle: `qa-ecom-016-in-${index}-${stamp}`,
      sku: `QA-ECOM-016-IN-${index}-${stamp}`,
      categoryIds: [inCategoryId],
    });
    await createPriceRowFixture(request, token, tracker, {
      productId,
      priceKindId,
      channelId: store.salesChannelId,
      unitPriceNet: 10 * index,
      unitPriceGross: Math.round(1230 * index) / 100,
    });
    inScopeIds.push(productId);
  }
  const outOfScopeIds: string[] = [];
  for (let index = 1; index <= OUT_OF_SCOPE_COUNT; index += 1) {
    outOfScopeIds.push(
      await createProductFixture(request, token, tracker, {
        title: `QA ECOM 016 Out ${index} ${marker} ${secondMarker}`,
        handle: `qa-ecom-016-out-${index}-${stamp}`,
        sku: `QA-ECOM-016-OUT-${index}-${stamp}`,
        categoryIds: [outCategoryId],
      }),
    );
  }
  const inactiveId = await createProductFixture(request, token, tracker, {
    title: `QA ECOM 016 Inactive ${marker}`,
    handle: `qa-ecom-016-inactive-${stamp}`,
    sku: `QA-ECOM-016-INACTIVE-${stamp}`,
    categoryIds: [inCategoryId],
    isActive: false,
  });

  const groupId = await createB2bGroupFixture(request, token, tracker, {
    stamp,
    label: '016',
    priceKindId,
    assortmentScope: { categoryIds: [inCategoryId] },
  });
  const groupBuyer = await createCompanyBuyerFixture(request, token, tracker, { stamp, label: '016', groupId });
  const tokensIndexed = await waitForSearchTokens([...inScopeIds, ...outOfScopeIds]);

  return {
    store,
    marker,
    secondMarker,
    inCategoryId,
    outCategoryId,
    inScopeIds,
    outOfScopeIds,
    inactiveId,
    groupBuyer,
    tokensIndexed,
  };
}

function productIdsOf(body: StorefrontSearchSuggestBody | null): string[] {
  return (body?.products ?? []).map((product) => product.id);
}

function expectSuggestShape(body: StorefrontSearchSuggestBody | null, label: string): void {
  expect(body, label).not.toBeNull();
  expect(sortedIds(Object.keys(body ?? {})), label).toEqual(SUGGEST_RESPONSE_KEYS);
  expect(body?.suggestions, label).toEqual([]);
  for (const product of body?.products ?? []) {
    expect(sortedIds(Object.keys(product)), label).toEqual(SUGGEST_PRODUCT_KEYS);
  }
}

test.describe('TC-ECOM-016: storefront search suggest', () => {
  test.describe.configure({ timeout: 300_000 });

  test('ranks inside the buyer\'s assortment so a restricted buyer is never starved', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const tracker = createStorefrontFixtureTracker();
    const holder: { store: StorefrontFixture | null } = { store: null };
    try {
      const fixture = await createSearchFixture(request, token, tracker, holder);
      const host = fixture.store.hostname;
      const groupOptions = { cookie: fixture.groupBuyer.session.cookieHeader };
      const inScope = new Set(fixture.inScopeIds);
      const outOfScope = new Set(fixture.outOfScopeIds);
      const limit = String(SUGGEST_LIMIT);

      const anonymousMarker = await getStorefrontSearchSuggest(host, { query: { q: fixture.marker, limit: '20' } });
      expect(anonymousMarker.status, anonymousMarker.text).toBe(200);
      expectSuggestShape(anonymousMarker.suggest, 'anonymous marker');
      expect(anonymousMarker.suggest?.products.length).toBe(20);
      expect(productIdsOf(anonymousMarker.suggest)).not.toContain(fixture.inactiveId);
      expect(sortedIds((anonymousMarker.suggest?.categories ?? []).map((entry) => entry.id))).toEqual(
        sortedIds([fixture.inCategoryId, fixture.outCategoryId]),
      );

      const infix = await getStorefrontSearchSuggest(host, { query: { q: fixture.marker.slice(4), limit } });
      expect(infix.status, infix.text).toBe(200);
      const tokensServed = fixture.tokensIndexed && (infix.suggest?.products.length ?? 0) === 0;
      test.info().annotations.push({
        type: 'search-backend',
        description: tokensServed ? 'tokens (marker), ILIKE or pgvector (2-char term)' : 'ILIKE or pgvector (tokens not serving)',
      });

      const groupMarker = await getStorefrontSearchSuggest(host, { ...groupOptions, query: { q: fixture.marker, limit } });
      expect(groupMarker.status, groupMarker.text).toBe(200);
      expect(groupMarker.headers['cache-control']).toBe(PRIVATE_CACHE_CONTROL);
      expectSuggestShape(groupMarker.suggest, 'group marker');
      expect(groupMarker.suggest?.products.length, 'a full page for the restricted buyer').toBe(SUGGEST_LIMIT);
      expect(productIdsOf(groupMarker.suggest).every((id) => inScope.has(id))).toBe(true);
      expect((groupMarker.suggest?.categories ?? []).map((entry) => entry.id)).toEqual([fixture.inCategoryId]);

      const bothMarkers = `${fixture.marker} ${fixture.secondMarker}`;
      const anonymousBoth = await getStorefrontSearchSuggest(host, { query: { q: bothMarkers, limit } });
      expect(anonymousBoth.status, anonymousBoth.text).toBe(200);
      expect(anonymousBoth.suggest?.products.length).toBe(SUGGEST_LIMIT);
      expect(
        productIdsOf(anonymousBoth.suggest).every((id) => outOfScope.has(id)),
        'the unrestricted top-k is dominated by products outside the restricted assortment',
      ).toBe(true);

      if (tokensServed) {
        const groupBoth = await getStorefrontSearchSuggest(host, { ...groupOptions, query: { q: bothMarkers, limit } });
        expect(groupBoth.status, groupBoth.text).toBe(200);
        expectSuggestShape(groupBoth.suggest, 'group both markers');
        expect(groupBoth.suggest?.products.length, 'tokens: scope applied inside the ranking query').toBe(SUGGEST_LIMIT);
        expect(productIdsOf(groupBoth.suggest).every((id) => inScope.has(id))).toBe(true);
      }
    } finally {
      await cleanupStorefrontCatalogFixtures(request, token, tracker);
      await cleanupStorefrontFixture(request, token, holder.store);
    }
  });

  test('every backend returns the same payload for the same product and short terms return empty', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const tracker = createStorefrontFixtureTracker();
    const holder: { store: StorefrontFixture | null } = { store: null };
    try {
      const fixture = await createSearchFixture(request, token, tracker, holder);
      const host = fixture.store.hostname;
      const groupOptions = { cookie: fixture.groupBuyer.session.cookieHeader };
      const inScope = new Set(fixture.inScopeIds);

      const twoCharacter = await getStorefrontSearchSuggest(host, {
        ...groupOptions,
        query: { q: fixture.marker.slice(0, 2), limit: '20' },
      });
      expect(twoCharacter.status, twoCharacter.text).toBe(200);
      expectSuggestShape(twoCharacter.suggest, 'two-character term');
      expect(sortedIds(productIdsOf(twoCharacter.suggest))).toEqual(sortedIds(fixture.inScopeIds));
      for (const product of twoCharacter.suggest?.products ?? []) {
        expect(product.formattedPrice, product.title).not.toBeNull();
      }

      const fullMarker = await getStorefrontSearchSuggest(host, { ...groupOptions, query: { q: fixture.marker, limit: '20' } });
      expect(fullMarker.status, fullMarker.text).toBe(200);
      expectSuggestShape(fullMarker.suggest, 'full marker');
      expect(sortedIds(productIdsOf(fullMarker.suggest))).toEqual(sortedIds(fixture.inScopeIds));
      const byId = new Map((twoCharacter.suggest?.products ?? []).map((product) => [product.id, product]));
      for (const product of fullMarker.suggest?.products ?? []) {
        expect(inScope.has(product.id)).toBe(true);
        expect(product, 'identical payload whichever backend ranked it').toEqual(byId.get(product.id));
      }
      expect(fullMarker.suggest?.categories).toEqual(twoCharacter.suggest?.categories);

      const oneCharacter = await getStorefrontSearchSuggest(host, { ...groupOptions, query: { q: fixture.marker.slice(0, 1) } });
      expect(oneCharacter.status, oneCharacter.text).toBe(200);
      expect(oneCharacter.suggest?.products).toEqual([]);
      expect(oneCharacter.suggest?.categories).toEqual([]);

      const missing = await getStorefrontSearchSuggest(host);
      expect(missing.status, missing.text).toBe(400);
      const overLimit = await getStorefrontSearchSuggest(host, { query: { q: fixture.marker, limit: '21' } });
      expect(overLimit.status, overLimit.text).toBe(400);
      const unknown = await getStorefrontSearchSuggest(host, { query: { q: fixture.marker, Limit: '5' } });
      expect(unknown.status, unknown.text).toBe(400);
    } finally {
      await cleanupStorefrontCatalogFixtures(request, token, tracker);
      await cleanupStorefrontFixture(request, token, holder.store);
    }
  });
});
