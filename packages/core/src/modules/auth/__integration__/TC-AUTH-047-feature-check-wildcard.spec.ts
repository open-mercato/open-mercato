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
 * TC-AUTH-047 [P1]: feature-check honours wildcard ACL grants (#2464)
 *
 * The effective grant set is matchFeature() applied over filterGrantsByEnabledModules(). That
 * honours MODULE-level wildcards (`auth.*`) and the global `*`, but NOT sub-namespace wildcards
 * (`auth.users.*`): filterGrantsByEnabledModules() resolves the owning module of `auth.users.*`
 * to `auth.users`, which is not an enabled module, so the grant is dropped (verified in
 * packages/shared/src/security/enabledModulesRegistry.ts). This spec exercises the honoured
 * forms — a module wildcard scoped to its own module, and the cross-module global wildcard.
 * Each fresh user receives exactly one grant (re-granting one user races the rbac cache).
 */
type FeatureCheckResponse = { ok?: boolean; granted?: string[] };

test.describe('TC-AUTH-047: feature-check wildcard matching (#2464)', () => {
  test('module and global wildcards match per the matchFeature contract', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const { organizationId } = getTokenContext(superadminToken);
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`;
    let roleId: string | null = null;
    const userIds: string[] = [];

    // Create a fresh user (zero-feature role), grant exactly one wildcard, then log in as that user.
    const grantAndLogin = async (label: string, grantFeatures: string[]): Promise<string> => {
      const email = `qa-tc-auth-047-${label}-${stamp}@example.com`;
      const password = 'StrongSecret123!';
      const userId = await createUserFixture(request, superadminToken, {
        email,
        password,
        organizationId,
        roles: [roleId as string],
        name: `QA TC-AUTH-047 ${label}`,
      });
      userIds.push(userId);
      const put = await apiRequest(request, 'PUT', '/api/auth/users/acl', {
        token: superadminToken,
        data: { userId, features: grantFeatures },
      });
      expect(put.status(), `PUT user ACL ${JSON.stringify(grantFeatures)} should return 200`).toBe(200);
      return getAuthToken(request, email, password);
    };
    const featureCheck = async (token: string, features: string[]): Promise<FeatureCheckResponse> => {
      const res = await apiRequest(request, 'POST', '/api/auth/feature-check', { token, data: { features } });
      expect(res.status(), 'feature-check should return 200').toBe(200);
      return (await readJsonSafe<FeatureCheckResponse>(res)) ?? {};
    };

    try {
      roleId = await createRoleFixture(request, superadminToken, { name: `qa-tc-auth-047-${stamp}` });

      // A module wildcard `auth.*` satisfies every auth.* feature...
      const moduleToken = await grantAndLogin('module', ['auth.*']);
      const inModule = await featureCheck(moduleToken, ['auth.users.list', 'auth.roles.manage']);
      expect(inModule.ok, 'auth.* should satisfy all requested auth.* features').toBe(true);
      expect(inModule.granted ?? [], 'auth.* should grant auth.users.list').toContain('auth.users.list');
      expect(inModule.granted ?? [], 'auth.* should grant auth.roles.manage').toContain('auth.roles.manage');

      // ...but is scoped to its own module: it does NOT grant another module's feature.
      const crossModule = await featureCheck(moduleToken, ['auth.users.list', 'directory.organizations.view']);
      expect(crossModule.ok, 'auth.* should not satisfy a directory.* feature').toBe(false);
      expect(crossModule.granted ?? [], 'auth.* still grants the in-module feature').toContain('auth.users.list');
      expect(
        crossModule.granted ?? [],
        'auth.* does not grant a different module feature',
      ).not.toContain('directory.organizations.view');

      // The global `*` wildcard matches any feature across modules.
      const globalToken = await grantAndLogin('global', ['*']);
      const global = await featureCheck(globalToken, ['auth.users.list', 'directory.organizations.view']);
      expect(global.ok, 'the global * wildcard should satisfy any feature').toBe(true);
    } finally {
      for (const id of userIds) {
        await deleteUserIfExists(request, superadminToken, id);
      }
      await deleteRoleIfExists(request, superadminToken, roleId);
    }
  });
});
