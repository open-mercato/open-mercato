import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  cleanupSecondTenantActor,
  cleanupStorefrontFixture,
  createSecondTenantActor,
  createStorefrontFixture,
  uniqueStamp,
  type SecondTenantActor,
  type StorefrontFixture,
} from './helpers';
import {
  PRODUCT_NOT_FOUND_BODY,
  STOREFRONT_ERROR_CACHE_CONTROL,
  cleanupStorefrontCatalogFixtures,
  createCategoryFixture,
  createProductFixture,
  createStorefrontFixtureTracker,
  deleteProductFixture,
  getStorefrontProduct,
  getStorefrontProducts,
  itemIds,
} from './storefrontCatalogHelpers';

/**
 * TC-ECOM-011: product enumeration oracle and cross-tenant isolation.
 * Source: .ai/specs/2026-08-14-storefront-public-api.md (rev 4) §12 "Assortment and isolation"
 * (identical 404 for inactive, deleted and out-of-assortment products, R4; products of another
 * tenant never appear) and the §13 Phase 1 gate "the enumeration-oracle test shows no divergence";
 * release acceptance "zero cross-tenant leakage".
 *
 * Timing is not asserted here: an integration run on a shared environment cannot separate a
 * timing side channel from noise, so the oracle is held to identical status, body and cache
 * headers; the single-query lookup that removes the timing channel is pinned at unit level.
 */
const TENANT_B_FEATURES = ['ecommerce.*', 'sales.*', 'catalog.*', 'customer_accounts.*'];

type NotFoundProbe = { status: number; text: string; cacheControl: string | undefined; vary: string | undefined };

test.describe('TC-ECOM-011: storefront enumeration oracle and tenant isolation', () => {
  test.describe.configure({ timeout: 180_000 });

  test('restricted, inactive, deleted, foreign and nonexistent products answer one identical 404', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = uniqueStamp();
    const tracker = createStorefrontFixtureTracker();
    const foreignTracker = createStorefrontFixtureTracker();
    let store: StorefrontFixture | null = null;
    let actor: SecondTenantActor | null = null;
    try {
      const rootId = await createCategoryFixture(request, token, tracker, { name: `QA ECOM 011 Root ${stamp}` });
      const outsideId = await createCategoryFixture(request, token, tracker, { name: `QA ECOM 011 Outside ${stamp}` });
      store = await createStorefrontFixture(request, token, {
        stamp,
        channelAssortmentScope: { categoryIds: [rootId] },
      });

      const product = (suffix: string) => ({
        title: `QA ECOM 011 ${suffix} ${stamp}`,
        handle: `qa-ecom-011-${suffix}-${stamp}`,
        sku: `QA-ECOM-011-${suffix.toUpperCase()}-${stamp}`,
      });
      const visible = product('visible');
      const visibleId = await createProductFixture(request, token, tracker, { ...visible, categoryIds: [rootId] });
      const restricted = product('restricted');
      const restrictedId = await createProductFixture(request, token, tracker, {
        ...restricted,
        categoryIds: [outsideId],
      });
      const inactive = product('inactive');
      const inactiveId = await createProductFixture(request, token, tracker, {
        ...inactive,
        categoryIds: [rootId],
        isActive: false,
      });
      const deleted = product('deleted');
      const deletedId = await createProductFixture(request, token, tracker, { ...deleted, categoryIds: [rootId] });
      await deleteProductFixture(request, token, deletedId);

      actor = await createSecondTenantActor(request, superadminToken, stamp, TENANT_B_FEATURES);
      const foreign = product('foreign');
      const foreignId = await createProductFixture(request, actor.token, foreignTracker, foreign);

      const control = await getStorefrontProduct(store.hostname, visible.handle);
      expect(control.status, control.text).toBe(200);
      expect(control.detail?.id).toBe(visibleId);
      const controlList = await getStorefrontProducts(store.hostname);
      expect(controlList.status, controlList.text).toBe(200);
      expect(itemIds(controlList.list)).toEqual([visibleId]);

      const probes: Array<{ label: string; idOrHandle: string }> = [
        { label: 'nonexistent handle', idOrHandle: `qa-ecom-011-missing-${stamp}` },
        { label: 'nonexistent id', idOrHandle: randomUUID() },
        { label: 'restricted handle', idOrHandle: restricted.handle },
        { label: 'restricted id', idOrHandle: restrictedId },
        { label: 'inactive handle', idOrHandle: inactive.handle },
        { label: 'inactive id', idOrHandle: inactiveId },
        { label: 'deleted handle', idOrHandle: deleted.handle },
        { label: 'deleted id', idOrHandle: deletedId },
        { label: 'other-tenant handle', idOrHandle: foreign.handle },
        { label: 'other-tenant id', idOrHandle: foreignId },
      ];
      let baseline: NotFoundProbe | null = null;
      for (const probe of probes) {
        const response = await getStorefrontProduct(store.hostname, probe.idOrHandle);
        const observed: NotFoundProbe = {
          status: response.status,
          text: response.text,
          cacheControl: response.headers['cache-control'],
          vary: response.headers['vary'],
        };
        expect(observed.status, `${probe.label}: ${observed.text}`).toBe(404);
        expect(response.body, probe.label).toEqual(PRODUCT_NOT_FOUND_BODY);
        expect(observed.cacheControl, probe.label).toBe(STOREFRONT_ERROR_CACHE_CONTROL);
        baseline ??= observed;
        expect(observed, `${probe.label} must be indistinguishable from a nonexistent product`).toEqual(baseline);
      }
    } finally {
      if (actor) await cleanupStorefrontCatalogFixtures(request, actor.token, foreignTracker);
      await cleanupSecondTenantActor(request, superadminToken, actor);
      await cleanupStorefrontCatalogFixtures(request, token, tracker);
      await cleanupStorefrontFixture(request, token, store);
    }
  });

  test('a second tenant\'s store never lists or serves the first tenant\'s products', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = uniqueStamp();
    const tracker = createStorefrontFixtureTracker();
    const foreignTracker = createStorefrontFixtureTracker();
    let store: StorefrontFixture | null = null;
    let foreignStore: StorefrontFixture | null = null;
    let actor: SecondTenantActor | null = null;
    try {
      const sharedHandle = `qa-ecom-011-shared-${stamp}`;
      const searchToken = `isolation${stamp.replace(/[^a-z0-9]/gi, '')}`;
      const rootId = await createCategoryFixture(request, token, tracker, { name: `QA ECOM 011 Root ${stamp}` });
      store = await createStorefrontFixture(request, token, {
        stamp,
        channelAssortmentScope: { categoryIds: [rootId] },
      });
      const ownId = await createProductFixture(request, token, tracker, {
        title: `QA ECOM 011 Tenant A ${searchToken}`,
        handle: sharedHandle,
        sku: `QA-ECOM-011-A-${stamp}`,
        categoryIds: [rootId],
      });

      actor = await createSecondTenantActor(request, superadminToken, stamp, TENANT_B_FEATURES);
      foreignStore = await createStorefrontFixture(request, actor.token, { stamp: `${stamp}-b` });
      const foreignId = await createProductFixture(request, actor.token, foreignTracker, {
        title: `QA ECOM 011 Tenant B ${searchToken}`,
        handle: sharedHandle,
        sku: `QA-ECOM-011-B-${stamp}`,
      });

      const foreignList = await getStorefrontProducts(foreignStore.hostname, { query: { pageSize: '100' } });
      expect(foreignList.status, foreignList.text).toBe(200);
      expect(itemIds(foreignList.list)).toContain(foreignId);
      expect(itemIds(foreignList.list)).not.toContain(ownId);
      expect(foreignList.text).not.toContain(ownId);

      const foreignSearch = await getStorefrontProducts(foreignStore.hostname, { query: { search: searchToken } });
      expect(foreignSearch.status, foreignSearch.text).toBe(200);
      expect(itemIds(foreignSearch.list)).toEqual([foreignId]);

      const ownSearch = await getStorefrontProducts(store.hostname, { query: { search: searchToken } });
      expect(ownSearch.status, ownSearch.text).toBe(200);
      expect(itemIds(ownSearch.list)).toEqual([ownId]);
      expect(ownSearch.text).not.toContain(foreignId);

      const ownByHandle = await getStorefrontProduct(store.hostname, sharedHandle);
      expect(ownByHandle.status, ownByHandle.text).toBe(200);
      expect(ownByHandle.detail?.id).toBe(ownId);
      const foreignByHandle = await getStorefrontProduct(foreignStore.hostname, sharedHandle);
      expect(foreignByHandle.status, foreignByHandle.text).toBe(200);
      expect(foreignByHandle.detail?.id).toBe(foreignId);

      const crossToForeign = await getStorefrontProduct(foreignStore.hostname, ownId);
      expect(crossToForeign.status, crossToForeign.text).toBe(404);
      expect(crossToForeign.body).toEqual(PRODUCT_NOT_FOUND_BODY);
      const crossToOwn = await getStorefrontProduct(store.hostname, foreignId);
      expect(crossToOwn.status, crossToOwn.text).toBe(404);
      expect(crossToOwn.body).toEqual(PRODUCT_NOT_FOUND_BODY);
    } finally {
      if (actor) {
        await cleanupStorefrontCatalogFixtures(request, actor.token, foreignTracker);
        await cleanupStorefrontFixture(request, actor.token, foreignStore);
      }
      await cleanupSecondTenantActor(request, superadminToken, actor);
      await cleanupStorefrontCatalogFixtures(request, token, tracker);
      await cleanupStorefrontFixture(request, token, store);
    }
  });
});
