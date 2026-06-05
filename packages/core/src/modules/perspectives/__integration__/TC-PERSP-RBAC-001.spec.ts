import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createRoleFixture,
  deleteRoleIfExists,
  createUserFixture,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

export const integrationMeta = {
  dependsOnModules: ['perspectives'],
};

/**
 * TC-PERSP-RBAC-001 (#2491): the perspectives.use feature guards every perspectives route.
 *
 * The GET/POST handlers on /api/perspectives/[tableId] declare
 * `metadata.requireFeatures: ['perspectives.use']`, enforced centrally by the API
 * dispatcher (apps/mercato/src/app/api/[...slug]/route.ts -> checkAuthorization): an
 * authenticated user missing the feature is rejected with 403 before the handler runs.
 * A featureless custom role + user proves the boundary holds.
 */
test.describe('TC-PERSP-RBAC-001: perspectives.use feature is required', () => {
  test('denies perspectives access to a user without the perspectives.use feature', async ({ request }) => {
    test.slow();
    const stamp = Date.now();
    const password = 'Secret123!';
    const email = `qa-persp-rbac-001-${stamp}@example.com`;
    const tableId = `qa-persp-rbac-001-${stamp}`;

    let adminToken: string | null = null;
    let roleId: string | null = null;
    let userId: string | null = null;

    try {
      adminToken = await getAuthToken(request, 'admin');
      const { organizationId } = getTokenContext(adminToken);

      // Featureless role + user: no perspectives.use anywhere in the ACL chain.
      roleId = await createRoleFixture(request, adminToken, { name: `TC-PERSP-RBAC-001 Role ${stamp}` });
      userId = await createUserFixture(request, adminToken, {
        email,
        password,
        organizationId,
        roles: [roleId],
      });
      const userToken = await getAuthToken(request, email, password);

      // The caller is authenticated (valid token) but lacks the feature, so the dispatcher
      // feature gate rejects with 403 before the handler runs (401 only fires for missing auth).
      const getRes = await apiRequest(request, 'GET', `/api/perspectives/${encodeURIComponent(tableId)}`, { token: userToken });
      expect(getRes.status(), 'GET without perspectives.use is forbidden').toBe(403);
      const getBody = await readJsonSafe<{ error?: unknown }>(getRes);
      expect(typeof getBody?.error === 'string' && (getBody!.error as string).length > 0, 'GET response carries an error message').toBe(true);

      const postRes = await apiRequest(request, 'POST', `/api/perspectives/${encodeURIComponent(tableId)}`, {
        token: userToken,
        data: { name: `Blocked ${stamp}`, settings: { pageSize: 10 } },
      });
      expect(postRes.status(), 'POST without perspectives.use is forbidden').toBe(403);
      const postBody = await readJsonSafe<{ error?: unknown }>(postRes);
      expect(typeof postBody?.error === 'string' && (postBody!.error as string).length > 0, 'POST response carries an error message').toBe(true);
    } finally {
      await deleteUserIfExists(request, adminToken, userId);
      await deleteRoleIfExists(request, adminToken, roleId);
    }
  });
});
