import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  getTokenContext,
  deleteGeneralEntityIfExists,
} from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-DIR-011: Cross-tenant organization read isolation
 * Covers: GET /api/directory/organizations
 *
 * A non-superadmin caller must never read organizations belonging to a tenant they are not
 * scoped to. The seeded `admin` is scoped to its own tenant; a freshly created tenant B (with
 * an organization) is the foreign tenant. When the admin requests `?tenantId=<B>`, the route's
 * `enforceTenantScope` refuses to honor the foreign tenant: it either returns 400
 * "Tenant scope required" or silently falls back to the admin's own tenant — in both cases the
 * tenant-B organization must be absent from the response. The security invariant under test is
 * "no cross-tenant leak", asserted regardless of which of those two safe outcomes occurs.
 */
test.describe('TC-DIR-011: Cross-tenant organization read isolation', () => {
  let superToken: string | null = null;
  let adminToken: string | null = null;
  let ownTenantId = '';
  let foreignTenantId: string | null = null;
  let foreignOrgId: string | null = null;
  const stamp = Date.now();

  test.beforeAll(async ({ request }) => {
    superToken = await getAuthToken(request, 'superadmin');
    adminToken = await getAuthToken(request, 'admin');
    ownTenantId = getTokenContext(adminToken).tenantId;
    expect(ownTenantId, 'admin should be scoped to a tenant').toBeTruthy();

    const tenantRes = await apiRequest(request, 'POST', '/api/directory/tenants', {
      token: superToken,
      data: { name: `QA TC-DIR-011 Foreign ${stamp}` },
    });
    expect(tenantRes.status(), 'superadmin should create the foreign tenant').toBe(201);
    foreignTenantId = ((await tenantRes.json()) as { id?: string }).id ?? null;
    expect(foreignTenantId, 'foreign tenant id').toBeTruthy();
    expect(foreignTenantId, 'foreign tenant must differ from the admin tenant').not.toBe(ownTenantId);

    const orgRes = await apiRequest(request, 'POST', '/api/directory/organizations', {
      token: superToken,
      data: { name: `QA TC-DIR-011 Foreign Org ${stamp}`, tenantId: foreignTenantId },
    });
    expect(orgRes.status(), 'superadmin should create an org in the foreign tenant').toBe(201);
    foreignOrgId = ((await orgRes.json()) as { id?: string }).id ?? null;
    expect(foreignOrgId, 'foreign org id').toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    await deleteGeneralEntityIfExists(request, superToken, '/api/directory/organizations', foreignOrgId);
    await deleteGeneralEntityIfExists(request, superToken, '/api/directory/tenants', foreignTenantId);
  });

  test('superadmin can see the foreign-tenant organization (fixture sanity)', async ({ request }) => {
    const res = await apiRequest(
      request,
      'GET',
      `/api/directory/organizations?view=manage&tenantId=${encodeURIComponent(foreignTenantId!)}&ids=${encodeURIComponent(foreignOrgId!)}`,
      { token: superToken! },
    );
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { items?: Array<{ id?: string }> };
    const ids = (body.items ?? []).map((item) => item.id);
    expect(ids, 'superadmin should resolve the foreign org within its tenant').toContain(foreignOrgId);
  });

  test('admin requesting the foreign tenant never receives foreign-tenant organizations', async ({ request }) => {
    const res = await apiRequest(
      request,
      'GET',
      `/api/directory/organizations?view=manage&tenantId=${encodeURIComponent(foreignTenantId!)}`,
      { token: adminToken! },
    );
    // Either a hard scope rejection (400/403) or a silent down-scope to the admin's own tenant (200).
    expect([200, 400, 403], `unexpected status ${res.status()}`).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as { items?: Array<{ id?: string; tenantId?: string | null }> };
      const ids = (body.items ?? []).map((item) => item.id);
      expect(ids, 'foreign-tenant org must not leak to a non-member admin').not.toContain(foreignOrgId);
      for (const item of body.items ?? []) {
        expect(item.tenantId, 'no item may belong to the foreign tenant').not.toBe(foreignTenantId);
      }
    }
  });

  test('admin reading its own tenant gets only its own organizations', async ({ request }) => {
    const res = await apiRequest(
      request,
      'GET',
      `/api/directory/organizations?view=manage&tenantId=${encodeURIComponent(ownTenantId)}`,
      { token: adminToken! },
    );
    expect(res.status(), 'admin should read its own tenant').toBe(200);
    const body = (await res.json()) as { items?: Array<{ id?: string; tenantId?: string | null }> };
    const ids = (body.items ?? []).map((item) => item.id);
    expect(ids, 'foreign-tenant org must not appear in the own-tenant listing').not.toContain(foreignOrgId);
    for (const item of body.items ?? []) {
      expect(item.tenantId, 'every returned org should belong to the admin tenant').toBe(ownTenantId);
    }
  });
});
