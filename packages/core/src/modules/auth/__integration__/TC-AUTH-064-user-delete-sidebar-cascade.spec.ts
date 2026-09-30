import { expect, test } from '@playwright/test';
import { apiRequest, clearAuthTokenCache, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures';

/**
 * TC-AUTH-064: Deleting a user with sidebar rows succeeds
 *
 * `user_sidebar_preferences` and `sidebar_variants` both hold a foreign key to
 * `users`. The delete cascade in auth.users.delete never cleared them, so any
 * user who had customised their sidebar could not be deleted: Postgres rejected
 * the hard delete and the API answered with a bare 500. This spec writes both
 * kinds of sidebar rows as the target user, deletes the user as a superadmin,
 * and expects the delete to commit.
 */
test.describe('TC-AUTH-064: user delete sidebar cascade', () => {
  test('deletes a user who has a sidebar preference and a sidebar variant', async ({ request }) => {
    let adminToken: string | null = null;
    let roleId: string | null = null;
    let userId: string | null = null;
    const stamp = Date.now();
    const email = `qa-tc-auth-064-${stamp}@example.com`;
    const password = 'Sup3rSecret!pw';

    try {
      adminToken = await getAuthToken(request, 'superadmin');
      const { organizationId } = getTokenContext(adminToken);

      roleId = await createRoleFixture(request, adminToken, { name: `qa-tc-auth-064-${stamp}` });
      userId = await createUserFixture(request, adminToken, {
        email,
        password,
        organizationId,
        roles: [roleId],
        name: 'QA TC-AUTH-064',
      });
      await setUserAclVisibility(request, adminToken, {
        userId,
        organizations: null,
        features: ['auth.sidebar.manage'],
      });

      // Sidebar routes are self-scoped, so the rows must be written as the target user.
      const userToken = await getAuthToken(request, email, password);

      const prefRes = await apiRequest(request, 'PUT', '/api/auth/sidebar/preferences', {
        token: userToken,
        data: { groupLabels: { 'qa-tc-auth-064': `Group ${stamp}` } },
      });
      expect(prefRes.status(), 'PUT sidebar preferences should return 200').toBe(200);

      const variantRes = await apiRequest(request, 'POST', '/api/auth/sidebar/variants', {
        token: userToken,
        data: { name: `QA TC-AUTH-064 ${stamp}`, isActive: false, settings: { groupLabels: { 'qa-tc-auth-064': `Variant ${stamp}` } } },
      });
      expect(variantRes.status(), 'POST sidebar variant should return 200').toBe(200);
      const variantBody = await readJsonSafe<{ variant?: { id?: string } }>(variantRes);
      expect(typeof variantBody?.variant?.id, 'variant creation should return an id').toBe('string');

      const deleteRes = await apiRequest(request, 'DELETE', `/api/auth/users?id=${encodeURIComponent(userId)}`, { token: adminToken });
      expect(deleteRes.status(), 'DELETE user with sidebar rows should return 200').toBe(200);
      const deletedUserId = userId;
      userId = null;

      const listRes = await apiRequest(request, 'GET', `/api/auth/users?id=${encodeURIComponent(deletedUserId)}`, { token: adminToken });
      expect(listRes.status(), 'GET users should return 200').toBe(200);
      const listBody = await readJsonSafe<{ items?: Array<{ id?: string }> }>(listRes);
      expect((listBody?.items ?? []).some((user) => user.id === deletedUserId), 'the user should be gone').toBe(false);

      // The deleted user's sessions are gone, so the cached token is no longer valid.
      clearAuthTokenCache();
      const staleRes = await apiRequest(request, 'GET', '/api/auth/sidebar/variants', { token: userToken });
      expect(staleRes.status(), 'the deleted user token should be rejected').toBe(401);
    } finally {
      clearAuthTokenCache();
      await deleteUserIfExists(request, adminToken, userId);
      await deleteRoleIfExists(request, adminToken, roleId);
    }
  });
});
