import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures';

/**
 * TC-AUTH-042: Deleting a user atomically cascades its ACL/role rows (issue #2339)
 *
 * auth.users.delete now runs the four dependent-row deletes (UserAcl, UserRole,
 * Session, PasswordReset) plus the user delete inside a single transaction. This
 * spec proves on a real database that a committed delete leaves no orphaned custom
 * user-ACL row, while unrelated entities (the role itself) are untouched.
 */
test.describe('TC-AUTH-042: user delete ACL cascade (#2339)', () => {
  test('removes the custom user ACL with no orphan and preserves the role', async ({ request }) => {
    let token: string | null = null;
    let roleId: string | null = null;
    let userId: string | null = null;
    const stamp = Date.now();

    try {
      token = await getAuthToken(request, 'superadmin');
      const { organizationId } = getTokenContext(token);

      roleId = await createRoleFixture(request, token, { name: `qa-tc-auth-042-${stamp}` });
      userId = await createUserFixture(request, token, {
        email: `qa-tc-auth-042-${stamp}@example.com`,
        password: 'Sup3rSecret!pw',
        organizationId,
        roles: [roleId],
        name: 'QA TC-AUTH-042',
      });

      // Give the user a custom ACL override so a UserAcl row exists to be cascaded.
      const setAclRes = await apiRequest(request, 'PUT', '/api/auth/users/acl', {
        token,
        data: { userId, features: ['directory.organizations.view'] },
      });
      expect(setAclRes.status(), 'PUT user ACL should return 200').toBe(200);

      const aclBefore = await readJsonSafe<{ hasCustomAcl?: boolean }>(
        await apiRequest(request, 'GET', `/api/auth/users/acl?userId=${encodeURIComponent(userId)}`, { token }),
      );
      expect(aclBefore?.hasCustomAcl, 'user should have a custom ACL before delete').toBe(true);

      const deleteRes = await apiRequest(request, 'DELETE', `/api/auth/users?id=${encodeURIComponent(userId)}`, { token });
      expect(deleteRes.status(), 'DELETE user should return 200').toBe(200);
      const deletedUserId = userId;
      userId = null;

      // The cascade committed: the UserAcl row is gone (no orphan).
      const aclAfter = await readJsonSafe<{ hasCustomAcl?: boolean }>(
        await apiRequest(request, 'GET', `/api/auth/users/acl?userId=${encodeURIComponent(deletedUserId)}`, { token }),
      );
      expect(aclAfter?.hasCustomAcl, 'user ACL should be removed after delete (no orphan)').toBe(false);

      // The role itself must survive — only the UserRole link is cascaded.
      const rolesRes = await apiRequest(request, 'GET', '/api/auth/roles?pageSize=100', { token });
      expect(rolesRes.status(), 'GET roles should return 200').toBe(200);
      const rolesBody = await readJsonSafe<{ items?: Array<{ id?: string }> }>(rolesRes);
      expect(
        (rolesBody?.items ?? []).some((role) => role.id === roleId),
        'the role should still exist after the user is deleted',
      ).toBe(true);
    } finally {
      await deleteUserIfExists(request, token, userId);
      await deleteRoleIfExists(request, token, roleId);
    }
  });
});
