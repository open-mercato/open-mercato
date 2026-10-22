import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  CHANNEL_BINDINGS_PATH,
  DOMAIN_BINDINGS_PATH,
  STORES_PATH,
  cleanupSecondTenantActor,
  cleanupStorefrontFixture,
  createPriceKindFixture,
  createSalesChannelFixture,
  createSecondTenantActor,
  createStoreFixture,
  createStorefrontFixture,
  deletePriceKindIfExists,
  deleteSalesChannelIfExists,
  deleteStoreIfExists,
  uniqueStamp,
  type SecondTenantActor,
  type StorefrontFixture,
} from './helpers';

/**
 * TC-ECOM-004: ecommerce admin API tenant isolation.
 * Source: .ai/specs/SPEC-029-2026-02-17-ecommerce-storefront-module.md §16 "API paths" — every
 * route in §9 asserting tenant isolation against a second-tenant fixture.
 *
 * Tenant B is a genuinely separate tenant (and therefore a separate organization), so a tenant-A
 * record reachable from tenant B — or a tenant-A domain mapping, sales channel or price kind
 * accepted as a reference by tenant B — is a real cross-tenant leak.
 */
const TENANT_B_FEATURES = ['ecommerce.*', 'sales.*', 'catalog.*', 'customer_accounts.*'];

type ListBody = { items?: Array<{ id: string }> };

test.describe('TC-ECOM-004: ecommerce admin API tenant isolation', () => {
  test.describe.configure({ timeout: 120_000 });

  test('stores and bindings of tenant A are invisible and unreachable from tenant B', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = uniqueStamp();
    let fixture: StorefrontFixture | null = null;
    let actor: SecondTenantActor | null = null;
    try {
      fixture = await createStorefrontFixture(request, token, { stamp });
      actor = await createSecondTenantActor(request, superadminToken, stamp, TENANT_B_FEATURES);

      const ownList = await apiRequest(request, 'GET', `${STORES_PATH}?pageSize=100&search=${fixture.stamp}`, { token });
      expect(ownList.status()).toBe(200);
      expect(((await readJsonSafe<ListBody>(ownList))?.items ?? []).map((item) => item.id)).toContain(fixture.storeId);

      const foreignList = await apiRequest(request, 'GET', `${STORES_PATH}?pageSize=100`, { token: actor.token });
      expect(foreignList.status()).toBe(200);
      expect(((await readJsonSafe<ListBody>(foreignList))?.items ?? []).some((item) => item.id === fixture!.storeId)).toBe(
        false,
      );

      const foreignById = await apiRequest(request, 'GET', `${STORES_PATH}?id=${fixture.storeId}`, { token: actor.token });
      expect(foreignById.status()).toBe(200);
      expect((await readJsonSafe<ListBody>(foreignById))?.items ?? []).toHaveLength(0);

      for (const [path, id] of [
        [CHANNEL_BINDINGS_PATH, fixture.channelBindingId],
        [DOMAIN_BINDINGS_PATH, fixture.domainBindingId],
      ] as const) {
        const response = await apiRequest(request, 'GET', `${path}?pageSize=100`, { token: actor.token });
        expect(response.status(), `${path} list from tenant B`).toBe(200);
        expect(((await readJsonSafe<ListBody>(response))?.items ?? []).some((item) => item.id === id)).toBe(false);
      }

      const foreignUpdate = await apiRequest(request, 'PUT', STORES_PATH, {
        token: actor.token,
        data: { id: fixture.storeId, name: 'cross-tenant rename attempt' },
      });
      expect(foreignUpdate.status(), 'tenant B update of a tenant-A store must 404').toBe(404);

      const foreignDelete = await apiRequest(request, 'DELETE', `${STORES_PATH}?id=${fixture.storeId}`, {
        token: actor.token,
      });
      expect(foreignDelete.status(), 'tenant B delete of a tenant-A store must 404').toBe(404);

      const survivor = await apiRequest(request, 'GET', `${STORES_PATH}?id=${fixture.storeId}`, { token });
      const survivorItems = (await readJsonSafe<{ items?: Array<{ id: string; name: string }> }>(survivor))?.items ?? [];
      expect(survivorItems[0]?.name).toBe(`QA ECOM Store ${fixture.stamp}`);
    } finally {
      await cleanupSecondTenantActor(request, superadminToken, actor);
      await cleanupStorefrontFixture(request, token, fixture);
    }
  });

  test('tenant B cannot bind its store to tenant A domain mappings, sales channels or price kinds', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = uniqueStamp();
    let fixture: StorefrontFixture | null = null;
    let actor: SecondTenantActor | null = null;
    let foreignPriceKindId: string | null = null;
    let tenantBStoreId: string | null = null;
    let tenantBChannelId: string | null = null;
    try {
      fixture = await createStorefrontFixture(request, token, { stamp });
      foreignPriceKindId = await createPriceKindFixture(request, token, {
        stamp,
        suffix: 'foreign',
        displayMode: 'including-tax',
      });
      actor = await createSecondTenantActor(request, superadminToken, stamp, TENANT_B_FEATURES);
      tenantBStoreId = await createStoreFixture(request, actor.token, { stamp: `${stamp}-b` });
      tenantBChannelId = await createSalesChannelFixture(request, actor.token, `${stamp}-b`);

      const domainBinding = await apiRequest(request, 'POST', DOMAIN_BINDINGS_PATH, {
        token: actor.token,
        data: { storeId: tenantBStoreId, domainMappingId: fixture.domainMappingId, isPrimary: true },
      });
      expect(domainBinding.status(), await domainBinding.text()).toBe(400);
      expect(
        (await readJsonSafe<{ fieldErrors?: Record<string, string> }>(domainBinding))?.fieldErrors ?? {},
      ).toHaveProperty('domainMappingId');

      const channelBinding = await apiRequest(request, 'POST', CHANNEL_BINDINGS_PATH, {
        token: actor.token,
        data: { storeId: tenantBStoreId, salesChannelId: fixture.salesChannelId, isDefault: true },
      });
      expect(channelBinding.status(), await channelBinding.text()).toBe(400);
      expect(
        (await readJsonSafe<{ fieldErrors?: Record<string, string> }>(channelBinding))?.fieldErrors ?? {},
      ).toHaveProperty('salesChannelId');

      const priceKindBinding = await apiRequest(request, 'POST', CHANNEL_BINDINGS_PATH, {
        token: actor.token,
        data: {
          storeId: tenantBStoreId,
          salesChannelId: tenantBChannelId,
          priceKindId: foreignPriceKindId,
          isDefault: true,
        },
      });
      expect(priceKindBinding.status(), await priceKindBinding.text()).toBe(400);
      expect(
        (await readJsonSafe<{ fieldErrors?: Record<string, string> }>(priceKindBinding))?.fieldErrors ?? {},
      ).toHaveProperty('priceKindId');

      const foreignStoreBinding = await apiRequest(request, 'POST', CHANNEL_BINDINGS_PATH, {
        token: actor.token,
        data: { storeId: fixture.storeId, salesChannelId: tenantBChannelId, isDefault: true },
      });
      expect(foreignStoreBinding.status(), await foreignStoreBinding.text()).toBe(400);
      expect(
        (await readJsonSafe<{ fieldErrors?: Record<string, string> }>(foreignStoreBinding))?.fieldErrors ?? {},
      ).toHaveProperty('storeId');
    } finally {
      if (actor) {
        await deleteStoreIfExists(request, actor.token, tenantBStoreId);
        await deleteSalesChannelIfExists(request, actor.token, tenantBChannelId);
      }
      await cleanupSecondTenantActor(request, superadminToken, actor);
      await deletePriceKindIfExists(request, token, foreignPriceKindId);
      await cleanupStorefrontFixture(request, token, fixture);
    }
  });
});
