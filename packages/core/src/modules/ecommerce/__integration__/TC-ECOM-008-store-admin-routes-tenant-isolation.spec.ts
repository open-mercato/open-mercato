import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  ASSORTMENT_COUNT_PATH,
  ECOMMERCE_DOMAIN_MAPPINGS_PATH,
  STORE_BRANDING_PATH,
  STORE_PREVIEW_BRANDING_PATH,
  cleanupSecondTenantActor,
  cleanupStorefrontFixture,
  createSecondTenantActor,
  createStorefrontFixture,
  readStoreRecord,
  toEpochMs,
  uniqueStamp,
  type SecondTenantActor,
  type StorefrontFixture,
} from './helpers';

/**
 * TC-ECOM-008: tenant isolation of the store admin routes added after TC-ECOM-004.
 * Source: .ai/specs/SPEC-029-2026-02-17-ecommerce-storefront-module.md §16 "API paths" — every
 * §9 route asserting tenant isolation against a second-tenant fixture. Covers
 * `PUT /stores/:id/branding`, `GET /stores/:id/preview-branding`,
 * `GET /store-channel-bindings/:id/assortment-count` and `GET /domain-mappings`.
 *
 * Tenant B holds every ecommerce feature, so a 404 (and not a 403) proves the record is scoped
 * out rather than the route being denied; the tenant-A record is re-read afterwards to prove
 * the attempted write never landed.
 */
const TENANT_B_FEATURES = ['ecommerce.*', 'sales.*', 'catalog.*', 'customer_accounts.*'];

type DomainMappingListBody = { items?: Array<{ id: string; hostname: string; status: string }>; total?: number };

test.describe('TC-ECOM-008: store admin routes added after TC-ECOM-004 are tenant-scoped', () => {
  test.describe.configure({ timeout: 120_000 });

  test('tenant B gets 404 from the branding, preview and assortment-count routes of a tenant-A store', async ({
    request,
  }) => {
    const token = await getAuthToken(request, 'admin');
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = uniqueStamp();
    let fixture: StorefrontFixture | null = null;
    let actor: SecondTenantActor | null = null;
    try {
      fixture = await createStorefrontFixture(request, token, { stamp });
      const branded = await apiRequest(request, 'PUT', STORE_BRANDING_PATH(fixture.storeId), {
        token,
        data: { primaryColor: '#112233' },
      });
      expect(branded.status(), `tenant A branding seed should be 200 (${await branded.text()})`).toBe(200);
      const before = await readStoreRecord(request, token, fixture.storeId);
      actor = await createSecondTenantActor(request, superadminToken, stamp, TENANT_B_FEATURES);

      const foreignBranding = await apiRequest(request, 'PUT', STORE_BRANDING_PATH(fixture.storeId), {
        token: actor.token,
        data: { primaryColor: '#ff0000' },
      });
      expect(foreignBranding.status(), `tenant B branding write must 404 (${await foreignBranding.text()})`).toBe(404);

      const foreignPreview = await apiRequest(
        request,
        'GET',
        `${STORE_PREVIEW_BRANDING_PATH(fixture.storeId)}?primaryColor=${encodeURIComponent('#ff0000')}`,
        { token: actor.token },
      );
      expect(foreignPreview.status(), 'tenant B branding preview must 404').toBe(404);
      expect(await foreignPreview.text()).not.toContain('--primary');

      const ownCount = await apiRequest(request, 'GET', ASSORTMENT_COUNT_PATH(fixture.channelBindingId ?? ''), { token });
      expect(ownCount.status(), 'tenant A counts its own binding').toBe(200);

      const foreignCount = await apiRequest(request, 'GET', ASSORTMENT_COUNT_PATH(fixture.channelBindingId ?? ''), {
        token: actor.token,
      });
      expect(foreignCount.status(), 'tenant B assortment count of a tenant-A binding must 404').toBe(404);
      expect((await readJsonSafe<Record<string, unknown>>(foreignCount)) ?? {}).not.toHaveProperty('count');

      const foreignDraftCount = await apiRequest(
        request,
        'GET',
        `${ASSORTMENT_COUNT_PATH(fixture.channelBindingId ?? '')}?draftScope=null&draftRequireAuthentication=false`,
        { token: actor.token },
      );
      expect(foreignDraftCount.status(), 'a draft scope does not bypass the binding scope check').toBe(404);

      const after = await readStoreRecord(request, token, fixture.storeId);
      expect(after.settings?.branding).toEqual({ primaryColor: '#112233' });
      expect(toEpochMs(after.updatedAt)).toBe(toEpochMs(before.updatedAt));
    } finally {
      await cleanupSecondTenantActor(request, superadminToken, actor);
      await cleanupStorefrontFixture(request, token, fixture);
    }
  });

  test('the domain-mappings picker lists only the caller organization mappings', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = uniqueStamp();
    let fixture: StorefrontFixture | null = null;
    let actor: SecondTenantActor | null = null;
    try {
      fixture = await createStorefrontFixture(request, token, { stamp, domainMappingStatus: 'verified' });
      actor = await createSecondTenantActor(request, superadminToken, stamp, TENANT_B_FEATURES);

      const ownList = await apiRequest(request, 'GET', ECOMMERCE_DOMAIN_MAPPINGS_PATH, { token });
      expect(ownList.status()).toBe(200);
      const ownItems = (await readJsonSafe<DomainMappingListBody>(ownList))?.items ?? [];
      const ownMapping = ownItems.find((item) => item.id === fixture?.domainMappingId);
      expect(ownMapping, 'tenant A sees its own mapping in any status').toBeTruthy();
      expect(ownMapping?.hostname).toBe(fixture.hostname);
      expect(ownMapping?.status).toBe('verified');

      const foreignList = await apiRequest(request, 'GET', ECOMMERCE_DOMAIN_MAPPINGS_PATH, { token: actor.token });
      expect(foreignList.status()).toBe(200);
      const foreignBody = await readJsonSafe<DomainMappingListBody>(foreignList);
      const foreignItems = foreignBody?.items ?? [];
      expect(foreignItems.some((item) => item.id === fixture?.domainMappingId)).toBe(false);
      expect(foreignItems.some((item) => item.hostname === fixture?.hostname)).toBe(false);
      expect(foreignBody?.total).toBe(foreignItems.length);
    } finally {
      await cleanupSecondTenantActor(request, superadminToken, actor);
      await cleanupStorefrontFixture(request, token, fixture);
    }
  });
});
