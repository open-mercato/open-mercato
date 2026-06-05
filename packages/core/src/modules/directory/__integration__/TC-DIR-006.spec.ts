import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  getTokenContext,
  deleteGeneralEntityIfExists,
} from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-DIR-006: RBAC enforcement — missing directory.*.manage blocks POST/PUT/DELETE
 * Covers: POST/PUT/DELETE /api/directory/organizations and /api/directory/tenants
 *
 * The employee role is granted no directory features by default — directory/setup.ts
 * only grants `superadmin: directory.tenants.*` and
 * `admin: directory.organizations.{view,manage}`. The route metadata feature gate
 * (requireFeatures) rejects an authenticated-but-unauthorized caller with 403 before
 * the handler runs, so the superadmin-owned fixtures are never mutated.
 */
test.describe('TC-DIR-006: RBAC enforcement on directory writes', () => {
  let superToken: string | null = null;
  let employeeToken: string | null = null;
  let superTenantId = '';
  let orgId: string | null = null;
  let tenantId: string | null = null;
  const stamp = Date.now();
  const orgName = `QA TC-DIR-006 Org ${stamp}`;

  test.beforeAll(async ({ request }) => {
    superToken = await getAuthToken(request, 'superadmin');
    employeeToken = await getAuthToken(request, 'employee');
    superTenantId = getTokenContext(superToken).tenantId;

    const tenantRes = await apiRequest(request, 'POST', '/api/directory/tenants', {
      token: superToken,
      data: { name: `QA TC-DIR-006 Tenant ${stamp}` },
    });
    expect(tenantRes.status(), 'superadmin should create the tenant fixture').toBe(201);
    tenantId = ((await tenantRes.json()) as { id?: string }).id ?? null;
    expect(tenantId, 'tenant fixture id').toBeTruthy();

    const orgRes = await apiRequest(request, 'POST', '/api/directory/organizations', {
      token: superToken,
      data: { name: orgName, tenantId: superTenantId },
    });
    expect(orgRes.status(), 'superadmin should create the organization fixture').toBe(201);
    orgId = ((await orgRes.json()) as { id?: string }).id ?? null;
    expect(orgId, 'organization fixture id').toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    await deleteGeneralEntityIfExists(request, superToken, '/api/directory/organizations', orgId);
    await deleteGeneralEntityIfExists(request, superToken, '/api/directory/tenants', tenantId);
  });

  test('employee is forbidden from organization writes (POST/PUT/DELETE -> 403)', async ({ request }) => {
    const token = employeeToken!;

    const createRes = await apiRequest(request, 'POST', '/api/directory/organizations', {
      token,
      data: { name: `QA TC-DIR-006 Denied ${stamp}`, tenantId: superTenantId },
    });
    expect(createRes.status(), 'POST /api/directory/organizations should be forbidden').toBe(403);

    const updateRes = await apiRequest(request, 'PUT', '/api/directory/organizations', {
      token,
      data: { id: orgId, name: `${orgName} HACKED` },
    });
    expect(updateRes.status(), 'PUT /api/directory/organizations should be forbidden').toBe(403);

    const deleteRes = await apiRequest(
      request,
      'DELETE',
      `/api/directory/organizations?id=${encodeURIComponent(orgId!)}`,
      { token },
    );
    expect(deleteRes.status(), 'DELETE /api/directory/organizations should be forbidden').toBe(403);
  });

  test('employee is forbidden from tenant writes (POST/PUT/DELETE -> 403)', async ({ request }) => {
    const token = employeeToken!;

    const createRes = await apiRequest(request, 'POST', '/api/directory/tenants', {
      token,
      data: { name: `QA TC-DIR-006 Denied Tenant ${stamp}` },
    });
    expect(createRes.status(), 'POST /api/directory/tenants should be forbidden').toBe(403);

    const updateRes = await apiRequest(request, 'PUT', '/api/directory/tenants', {
      token,
      data: { id: tenantId, name: `QA TC-DIR-006 Tenant ${stamp} HACKED` },
    });
    expect(updateRes.status(), 'PUT /api/directory/tenants should be forbidden').toBe(403);

    const deleteRes = await apiRequest(
      request,
      'DELETE',
      `/api/directory/tenants?id=${encodeURIComponent(tenantId!)}`,
      { token },
    );
    expect(deleteRes.status(), 'DELETE /api/directory/tenants should be forbidden').toBe(403);
  });

  test('denied employee writes left the organization fixture untouched', async ({ request }) => {
    // Confirms the 403s were gate denials, not handler-level errors after a partial mutation.
    const getRes = await apiRequest(
      request,
      'GET',
      `/api/directory/organizations?view=options&ids=${encodeURIComponent(orgId!)}&tenantId=${encodeURIComponent(superTenantId)}`,
      { token: superToken! },
    );
    expect(getRes.status(), 'superadmin can still read the fixture').toBe(200);
    const body = (await getRes.json()) as { items?: Array<{ id?: string; name?: string }> };
    const org = (body.items ?? []).find((item) => item.id === orgId);
    expect(org, 'organization fixture should still exist').toBeTruthy();
    expect(org?.name, 'organization name must be unchanged by the denied PUT').toBe(orgName);
  });
});
