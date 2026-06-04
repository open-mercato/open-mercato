import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createRoleFixture,
  deleteRoleIfExists,
  createUserFixture,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

export const integrationMeta = {
  dependsOnModules: ['perspectives'],
};

type RolePerspectiveDto = { id?: string; roleId?: string; roleName?: string | null; name?: string };
type SaveResponse = { rolePerspectives?: RolePerspectiveDto[] };
type StateResponse = {
  rolePerspectives?: RolePerspectiveDto[];
  roles?: Array<{ id?: string; hasPerspective?: boolean }>;
};

/**
 * TC-PERSP-ROLE-002 (#2491): DELETE /api/perspectives/[tableId]/roles/[roleId] clears every
 * role perspective for that role.
 *
 * The GET index only returns role perspectives for roles the caller belongs to, so the role's
 * state is observed through a dedicated member user assigned to the target role (granted
 * perspectives.use). The admin performs the role-default write and the role-scoped delete
 * (which require perspectives.role_defaults).
 */
test.describe('TC-PERSP-ROLE-002: delete role perspectives for a role', () => {
  test('removes the role perspective and reflects the cleared state to a role member', async ({ request }) => {
    test.slow();
    const stamp = Date.now();
    const password = 'Secret123!';
    const memberEmail = `qa-persp-role-002-${stamp}@example.com`;
    const tableId = `qa-persp-role-002-${stamp}`;
    const perspectiveName = `Role View ${stamp}`;

    let adminToken: string | null = null;
    let roleId: string | null = null;
    let memberId: string | null = null;

    try {
      adminToken = await getAuthToken(request, 'admin');
      const { organizationId } = getTokenContext(adminToken);

      const role = await createRoleFixture(request, adminToken, { name: `TC-PERSP-ROLE-002 Role ${stamp}` });
      roleId = role;
      memberId = await createUserFixture(request, adminToken, {
        email: memberEmail,
        password,
        organizationId,
        roles: [role],
      });
      await setUserAclVisibility(request, adminToken, {
        userId: memberId,
        features: ['perspectives.use'],
        organizations: [organizationId],
      });
      const memberToken = await getAuthToken(request, memberEmail, password);

      // Admin assigns a role perspective to the role.
      const saveRes = await apiRequest(request, 'POST', `/api/perspectives/${encodeURIComponent(tableId)}`, {
        token: adminToken,
        data: { name: perspectiveName, settings: { pageSize: 25 }, applyToRoles: [role] },
      });
      expect(saveRes.status(), 'admin save applyToRoles').toBe(200);
      const saveBody = await readJsonSafe<SaveResponse>(saveRes);
      expect(saveBody?.rolePerspectives ?? [], 'one role perspective created').toHaveLength(1);
      expect(saveBody!.rolePerspectives![0].roleId).toBe(role);

      // Member sees the role perspective before the delete.
      const before = await apiRequest(request, 'GET', `/api/perspectives/${encodeURIComponent(tableId)}`, { token: memberToken });
      expect(before.status()).toBe(200);
      const beforeState = await readJsonSafe<StateResponse>(before);
      const beforeRolePerspectives = (beforeState?.rolePerspectives ?? []).filter((rp) => rp.roleId === role);
      expect(beforeRolePerspectives, 'member sees the role perspective before delete').toHaveLength(1);
      expect(beforeRolePerspectives[0].name).toBe(perspectiveName);
      expect(beforeRolePerspectives[0].roleName, 'roleName populated in GET').toBeTruthy();
      expect((beforeState?.roles ?? []).find((entry) => entry.id === role)?.hasPerspective, 'roles[].hasPerspective true before delete').toBe(true);

      // Admin clears all role perspectives for the role.
      const del = await apiRequest(request, 'DELETE', `/api/perspectives/${encodeURIComponent(tableId)}/roles/${role}`, { token: adminToken });
      expect(del.status(), 'DELETE role perspectives returns 200').toBe(200);
      expect(await readJsonSafe<{ success?: boolean }>(del)).toEqual({ success: true });

      // Member no longer sees it.
      const after = await apiRequest(request, 'GET', `/api/perspectives/${encodeURIComponent(tableId)}`, { token: memberToken });
      expect(after.status()).toBe(200);
      const afterState = await readJsonSafe<StateResponse>(after);
      const afterRolePerspectives = (afterState?.rolePerspectives ?? []).filter((rp) => rp.roleId === role);
      expect(afterRolePerspectives, 'role perspective gone after delete').toHaveLength(0);
      expect((afterState?.roles ?? []).find((entry) => entry.id === role)?.hasPerspective, 'roles[].hasPerspective false after delete').toBe(false);
    } finally {
      if (adminToken && roleId) {
        await apiRequest(request, 'DELETE', `/api/perspectives/${encodeURIComponent(tableId)}/roles/${roleId}`, { token: adminToken }).catch(() => {});
      }
      await deleteUserIfExists(request, adminToken, memberId);
      await deleteRoleIfExists(request, adminToken, roleId);
    }
  });
});
