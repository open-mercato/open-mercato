import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createRoleFixture,
  deleteRoleIfExists,
  createUserFixture,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { deleteUserAclInDb } from '@open-mercato/core/helpers/integration/dbFixtures';
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { deleteResourceIfExists } from './helpers/resourcesFixtures';

export const integrationMeta = {
  dependsOnModules: ['resources'],
};

/**
 * TC-RESO-008 (issue #2461): RBAC permission gates on the resources routes.
 *
 * The module declares `resources.view` (read) and `resources.manage_resources`
 * (write, depends on view). This spec asserts the three permission tiers with a
 * SEPARATE user per tier so each route-guard evaluation reflects that user's
 * pre-set ACL (avoiding any same-session guard caching):
 *   - no features  -> 403 on GET/POST/PUT/DELETE and on tag assign
 *   - view only     -> GET 200, but writes (POST + assign) 403 (view != manage)
 *   - view + manage -> POST 201
 * Scope is injected from each user's token.
 */
const UNKNOWN_UUID = '00000000-0000-4000-8000-000000000000';

test.describe('TC-RESO-008: RBAC permission gates (403)', () => {
  test('no-access -> 403 everywhere; view-only -> read 200 / writes 403; manage -> writes succeed', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const { organizationId } = getTokenContext(adminToken);
    const stamp = Date.now();
    const password = 'Secret123!';
    const noAccessEmail = `tc-reso-008-noaccess-${stamp}@example.com`;
    const viewerEmail = `tc-reso-008-viewer-${stamp}@example.com`;
    const managerEmail = `tc-reso-008-manager-${stamp}@example.com`;

    let roleId: string | null = null;
    let noAccessUserId: string | null = null;
    let viewerUserId: string | null = null;
    let managerUserId: string | null = null;
    let createdResourceId: string | null = null;
    try {
      roleId = await createRoleFixture(request, adminToken, { name: `TC-RESO-008 Role ${stamp}` });

      // --- Tier 1: no features (empty role, no user ACL) ---
      noAccessUserId = await createUserFixture(request, adminToken, {
        email: noAccessEmail,
        password,
        organizationId,
        roles: [roleId],
      });
      const noAccessToken = await getAuthToken(request, noAccessEmail, password);

      expect(
        (await apiRequest(request, 'GET', '/api/resources/resources?pageSize=1', { token: noAccessToken })).status(),
        'no-access GET must be 403',
      ).toBe(403);
      expect(
        (await apiRequest(request, 'POST', '/api/resources/resources', { token: noAccessToken, data: { name: 'nope' } })).status(),
        'no-access POST must be 403',
      ).toBe(403);
      expect(
        (
          await apiRequest(request, 'PUT', '/api/resources/resources', {
            token: noAccessToken,
            data: { id: UNKNOWN_UUID, name: 'nope' },
          })
        ).status(),
        'no-access PUT must be 403',
      ).toBe(403);
      expect(
        (await apiRequest(request, 'DELETE', `/api/resources/resources?id=${UNKNOWN_UUID}`, { token: noAccessToken })).status(),
        'no-access DELETE must be 403',
      ).toBe(403);
      expect(
        (
          await apiRequest(request, 'POST', '/api/resources/resources/tags/assign', {
            token: noAccessToken,
            data: { resourceId: UNKNOWN_UUID, tagId: UNKNOWN_UUID },
          })
        ).status(),
        'no-access assign must be 403',
      ).toBe(403);

      // --- Tier 2: resources.view only ---
      viewerUserId = await createUserFixture(request, adminToken, {
        email: viewerEmail,
        password,
        organizationId,
        roles: [roleId],
      });
      await setUserAclVisibility(request, adminToken, {
        userId: viewerUserId,
        features: ['resources.view'],
        organizations: null,
      });
      const viewerToken = await getAuthToken(request, viewerEmail, password);

      expect(
        (await apiRequest(request, 'GET', '/api/resources/resources?pageSize=1', { token: viewerToken })).status(),
        'viewer GET must be 200',
      ).toBe(200);
      expect(
        (await apiRequest(request, 'POST', '/api/resources/resources', { token: viewerToken, data: { name: 'nope' } })).status(),
        'viewer POST must be 403 (view != manage)',
      ).toBe(403);
      expect(
        (
          await apiRequest(request, 'POST', '/api/resources/resources/tags/assign', {
            token: viewerToken,
            data: { resourceId: UNKNOWN_UUID, tagId: UNKNOWN_UUID },
          })
        ).status(),
        'viewer assign must be 403',
      ).toBe(403);

      // --- Tier 3: resources.view + resources.manage_resources ---
      managerUserId = await createUserFixture(request, adminToken, {
        email: managerEmail,
        password,
        organizationId,
        roles: [roleId],
      });
      await setUserAclVisibility(request, adminToken, {
        userId: managerUserId,
        features: ['resources.view', 'resources.manage_resources'],
        organizations: null,
      });
      const managerToken = await getAuthToken(request, managerEmail, password);

      const managerPost = await apiRequest(request, 'POST', '/api/resources/resources', {
        token: managerToken,
        data: { name: `QA RBAC Resource ${stamp}` },
      });
      expect(managerPost.status(), 'manager POST must succeed (201)').toBe(201);
      createdResourceId = (await readJsonSafe<{ id?: string }>(managerPost))?.id ?? null;
      expect(createdResourceId, 'manager create returns an id').toBeTruthy();
    } finally {
      await deleteResourceIfExists(request, adminToken, createdResourceId);
      await deleteUserIfExists(request, adminToken, noAccessUserId);
      await deleteUserIfExists(request, adminToken, viewerUserId);
      await deleteUserIfExists(request, adminToken, managerUserId);
      await deleteUserAclInDb(noAccessUserId ?? '').catch(() => undefined);
      await deleteUserAclInDb(viewerUserId ?? '').catch(() => undefined);
      await deleteUserAclInDb(managerUserId ?? '').catch(() => undefined);
      await deleteRoleIfExists(request, adminToken, roleId);
    }
  });
});
