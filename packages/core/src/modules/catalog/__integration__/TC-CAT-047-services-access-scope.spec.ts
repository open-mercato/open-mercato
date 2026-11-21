import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-CAT-047: catalog services access control and organization scoping
 *
 * Two sibling organizations are created in the admin tenant, with one service in each.
 * Verifies:
 * - a user without `catalog.services.view` gets 403 on `GET` and `POST /api/catalog/services`
 * - a user with `catalog.services.view` but not `catalog.services.manage` can list (200) but
 *   gets 403 on `POST`, `PUT` and `DELETE`
 * - a user whose role is limited to org A lists the org-A service and never the org-B one —
 *   not by `search`, not by `id=` and not by `ids=`
 * - the unrestricted admin with org B selected still sees the org-B service (control)
 *
 * Self-contained: organizations, roles, users and services are created through the API and
 * removed in `finally`.
 */
export const integrationMeta = { dependsOnModules: ['catalog'] };

const SERVICES_PATH = '/api/catalog/services';

type ServiceRow = { id: string; organization_id?: string | null };

async function createServiceInOrg(
  request: APIRequestContext,
  token: string,
  organizationId: string,
  title: string,
): Promise<string> {
  const response = await apiRequestWithSelectedOrg(request, 'POST', SERVICES_PATH, {
    token,
    selectedOrgId: organizationId,
    data: { title, defaultPriceAmount: 50, defaultPriceCurrencyCode: 'USD' },
  });
  expect(response.status(), `service fixture in org ${organizationId} should be 201: ${(await response.text()).slice(0, 300)}`).toBe(201);
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'service fixture should return an id');
}

async function listIds(request: APIRequestContext, token: string, query: string): Promise<string[]> {
  const response = await apiRequest(request, 'GET', `${SERVICES_PATH}?${query}`, { token });
  expect(response.status(), `GET ${SERVICES_PATH}?${query} should return 200`).toBe(200);
  const items = (await readJsonSafe<{ items?: ServiceRow[] }>(response))?.items ?? [];
  return items.map((item) => item.id);
}

async function deleteServiceInOrgIfExists(
  request: APIRequestContext,
  token: string,
  organizationId: string | null,
  serviceId: string | null,
): Promise<void> {
  if (!organizationId || !serviceId) return;
  await apiRequestWithSelectedOrg(request, 'DELETE', `${SERVICES_PATH}?id=${encodeURIComponent(serviceId)}`, {
    token,
    selectedOrgId: organizationId,
  }).catch(() => undefined);
}

test.describe('TC-CAT-047: catalog services access control and organization scope', () => {
  test('denies callers without the services features and hides other organizations services', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const superadminToken = await getAuthToken(request, 'superadmin');
    const { tenantId } = getTokenContext(adminToken);
    const stamp = `${Date.now()}${randomUUID().replace(/-/g, '').slice(0, 6)}`;
    const searchToken = `qasvcscope${stamp}`;
    const password = 'Valid1!Pass';

    let orgAId: string | null = null;
    let orgBId: string | null = null;
    let serviceAId: string | null = null;
    let serviceBId: string | null = null;
    let noServicesRoleId: string | null = null;
    let noServicesUserId: string | null = null;
    let orgAViewerRoleId: string | null = null;
    let orgAViewerUserId: string | null = null;

    try {
      orgAId = await createOrganizationFixture(request, superadminToken, { name: `QA CAT 047 Org A ${stamp}`, tenantId });
      orgBId = await createOrganizationFixture(request, superadminToken, { name: `QA CAT 047 Org B ${stamp}`, tenantId });
      serviceAId = await createServiceInOrg(request, adminToken, orgAId, `QA ${searchToken} A`);
      serviceBId = await createServiceInOrg(request, adminToken, orgBId, `QA ${searchToken} B`);

      noServicesRoleId = await createRoleFixture(request, superadminToken, { name: `QA CAT 047 No Services ${stamp}`, tenantId });
      await setRoleAclFeatures(request, superadminToken, {
        roleId: noServicesRoleId,
        features: ['catalog.products.view'],
        organizations: [orgAId],
      });
      const noServicesEmail = `qa-cat-047-none-${stamp}@test.invalid`;
      noServicesUserId = await createUserFixture(request, superadminToken, {
        email: noServicesEmail,
        password,
        organizationId: orgAId,
        roles: [noServicesRoleId],
      });
      const noServicesToken = await getAuthToken(request, noServicesEmail, password);

      const deniedList = await apiRequest(request, 'GET', `${SERVICES_PATH}?search=${encodeURIComponent(searchToken)}`, {
        token: noServicesToken,
      });
      expect(deniedList.status(), 'listing services without catalog.services.view must be 403').toBe(403);
      expect((await readJsonSafe<{ items?: unknown }>(deniedList))?.items, 'the 403 body must not carry rows').toBeUndefined();

      const deniedCreate = await apiRequest(request, 'POST', SERVICES_PATH, {
        token: noServicesToken,
        data: { title: `QA ${searchToken} denied` },
      });
      expect(deniedCreate.status(), 'creating a service without catalog.services.manage must be 403').toBe(403);

      orgAViewerRoleId = await createRoleFixture(request, superadminToken, { name: `QA CAT 047 Org A Viewer ${stamp}`, tenantId });
      await setRoleAclFeatures(request, superadminToken, {
        roleId: orgAViewerRoleId,
        features: ['catalog.services.view'],
        organizations: [orgAId],
      });
      const orgAViewerEmail = `qa-cat-047-viewer-${stamp}@test.invalid`;
      orgAViewerUserId = await createUserFixture(request, superadminToken, {
        email: orgAViewerEmail,
        password,
        organizationId: orgAId,
        roles: [orgAViewerRoleId],
      });
      const orgAViewerToken = await getAuthToken(request, orgAViewerEmail, password);

      const viewerCreate = await apiRequest(request, 'POST', SERVICES_PATH, {
        token: orgAViewerToken,
        data: { title: `QA ${searchToken} viewer create` },
      });
      expect(viewerCreate.status(), 'view-only users cannot create services').toBe(403);
      const viewerUpdate = await apiRequest(request, 'PUT', SERVICES_PATH, {
        token: orgAViewerToken,
        data: { id: serviceAId, title: `QA ${searchToken} viewer edit` },
      });
      expect(viewerUpdate.status(), 'view-only users cannot update services').toBe(403);
      const viewerDelete = await apiRequest(request, 'DELETE', `${SERVICES_PATH}?id=${encodeURIComponent(serviceAId)}`, {
        token: orgAViewerToken,
      });
      expect(viewerDelete.status(), 'view-only users cannot delete services').toBe(403);

      expect(
        await listIds(request, orgAViewerToken, `search=${encodeURIComponent(searchToken)}`),
        'an org-A user lists only the org-A service',
      ).toEqual([serviceAId]);
      expect(
        await listIds(request, orgAViewerToken, `id=${encodeURIComponent(serviceBId)}`),
        'an org-A user cannot read the org-B service by id',
      ).toEqual([]);
      expect(
        await listIds(request, orgAViewerToken, `ids=${encodeURIComponent(`${serviceAId},${serviceBId}`)}`),
        'naming the org-B service in ids does not leak it',
      ).toEqual([serviceAId]);

      const adminInOrgB = await apiRequestWithSelectedOrg(
        request,
        'GET',
        `${SERVICES_PATH}?id=${encodeURIComponent(serviceBId)}`,
        { token: adminToken, selectedOrgId: orgBId },
      );
      expect(adminInOrgB.status(), 'admin reading the org-B service with org B selected should be 200').toBe(200);
      const adminItems = (await readJsonSafe<{ items?: ServiceRow[] }>(adminInOrgB))?.items ?? [];
      expect(adminItems.map((item) => item.id), 'the org-B service exists for an org-B caller').toEqual([serviceBId]);

      const unchanged = await apiRequestWithSelectedOrg(
        request,
        'GET',
        `${SERVICES_PATH}?id=${encodeURIComponent(serviceAId)}`,
        { token: adminToken, selectedOrgId: orgAId },
      );
      const unchangedItems = (await readJsonSafe<{ items?: Array<ServiceRow & { title?: string }> }>(unchanged))?.items ?? [];
      expect(unchangedItems[0]?.title, 'denied writes leave the org-A service untouched').toBe(`QA ${searchToken} A`);
    } finally {
      await deleteServiceInOrgIfExists(request, adminToken, orgAId, serviceAId);
      await deleteServiceInOrgIfExists(request, adminToken, orgBId, serviceBId);
      await deleteUserIfExists(request, superadminToken, noServicesUserId);
      await deleteUserIfExists(request, superadminToken, orgAViewerUserId);
      await deleteRoleIfExists(request, superadminToken, noServicesRoleId);
      await deleteRoleIfExists(request, superadminToken, orgAViewerRoleId);
      await deleteOrganizationIfExists(request, superadminToken, orgAId);
      await deleteOrganizationIfExists(request, superadminToken, orgBId);
    }
  });
});
