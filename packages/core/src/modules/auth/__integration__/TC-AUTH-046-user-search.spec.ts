import { expect, test } from '@playwright/test';
import { randomInt } from 'node:crypto';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures';

/**
 * TC-AUTH-046 [P1]: Find users by name and role (#2464)
 *
 * GET /api/auth/users (guarded by `auth.users.list`) supports `?name=` and `?search=`.
 * `?name=` is a direct case-insensitive ILIKE on the user display name (deterministic).
 * `?search=` matches display names only through the search-token index, which is not
 * guaranteed to be populated synchronously in the integration runner — so display-name
 * isolation is asserted via `?name=`, while the `?search=` surface is exercised against a
 * shared role name (a direct ILIKE on the role name, no token dependency).
 */
type UserListItem = {
  id?: string;
  email?: string;
  name?: string | null;
  roles?: string[];
};

type UserListResponse = { items?: UserListItem[]; total?: number };

test.describe('TC-AUTH-046: user search and filtering (#2464)', () => {
  test('matches users by display name (case-insensitive) and by shared role via search', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const { organizationId } = getTokenContext(superadminToken);
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`;
    const alphaName = `QaAlpha${stamp}`;
    const betaName = `QaBeta${stamp}`;
    const sharedRoleName = `QaSearchRole-${stamp}`;
    let roleId: string | null = null;
    let alphaId: string | null = null;
    let betaId: string | null = null;

    const search = async (queryString: string): Promise<UserListResponse> => {
      const res = await apiRequest(request, 'GET', `/api/auth/users?${queryString}`, { token: superadminToken });
      expect(res.status(), `GET /api/auth/users?${queryString} should return 200`).toBe(200);
      return (await readJsonSafe<UserListResponse>(res)) ?? {};
    };
    const ids = (body: UserListResponse): string[] => (body.items ?? []).map((item) => item.id ?? '');

    try {
      roleId = await createRoleFixture(request, superadminToken, { name: sharedRoleName });
      alphaId = await createUserFixture(request, superadminToken, {
        email: `qa-tc-auth-046-alpha-${stamp}@example.com`,
        password: 'StrongSecret123!',
        organizationId,
        roles: [roleId],
        name: `${alphaName} Doe`,
      });
      betaId = await createUserFixture(request, superadminToken, {
        email: `qa-tc-auth-046-beta-${stamp}@example.com`,
        password: 'StrongSecret123!',
        organizationId,
        roles: [roleId],
        name: `${betaName} Smith`,
      });

      // Name search isolates each user.
      const byAlpha = await search(`name=${encodeURIComponent(alphaName)}&pageSize=50`);
      expect(ids(byAlpha), 'name search should return the matching user').toContain(alphaId);
      expect(ids(byAlpha), 'name search should not return the other user').not.toContain(betaId);

      const byBeta = await search(`name=${encodeURIComponent(betaName)}&pageSize=50`);
      expect(ids(byBeta), 'name search should return the matching user').toContain(betaId);
      expect(ids(byBeta), 'name search should not return the other user').not.toContain(alphaId);

      // Name search is case-insensitive.
      const byLowerAlpha = await search(`name=${encodeURIComponent(alphaName.toLowerCase())}&pageSize=50`);
      expect(ids(byLowerAlpha), 'name search should be case-insensitive').toContain(alphaId);

      // `?search=` against the shared role name returns both users (role-name match).
      const bySharedRole = await search(`search=${encodeURIComponent(sharedRoleName)}&pageSize=50`);
      expect(ids(bySharedRole), 'role search should include the first user').toContain(alphaId);
      expect(ids(bySharedRole), 'role search should include the second user').toContain(betaId);

      // Response items expose the documented shape.
      const alphaItem = (byAlpha.items ?? []).find((item) => item.id === alphaId);
      expect(alphaItem, 'matched item should be present').toBeTruthy();
      expect(typeof alphaItem?.email, 'item should expose email').toBe('string');
      expect(typeof alphaItem?.name, 'item should expose name').toBe('string');
      expect(Array.isArray(alphaItem?.roles), 'item should expose a roles array').toBe(true);
      expect(alphaItem?.roles, 'item roles should include the assigned role').toContain(sharedRoleName);
    } finally {
      await deleteUserIfExists(request, superadminToken, alphaId);
      await deleteUserIfExists(request, superadminToken, betaId);
      await deleteRoleIfExists(request, superadminToken, roleId);
    }
  });
});
