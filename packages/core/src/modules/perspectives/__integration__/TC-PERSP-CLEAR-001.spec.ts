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

type RolePerspectiveDto = { roleId?: string };
type SaveResponse = {
  perspective?: { id?: string; updatedAt?: string | null };
  rolePerspectives?: RolePerspectiveDto[];
  clearedRoleIds?: string[];
};
type StateResponse = {
  perspectives?: Array<{ id?: string; updatedAt?: string | null }>;
  rolePerspectives?: RolePerspectiveDto[];
};

/**
 * TC-PERSP-CLEAR-001 (#2491): POST clearRoleIds removes the listed role perspectives in the
 * same transaction as a personal save, without deleting the personal perspective and without
 * touching role perspectives that were not listed.
 *
 * Per-role state is observed through member users (GET only surfaces a caller's own roles):
 * one member for role A (cleared) and one for role B (kept). The personal perspective is the
 * admin's own, so it is read back directly from the admin GET.
 */
test.describe('TC-PERSP-CLEAR-001: clearRoleIds removes role perspectives without affecting personal', () => {
  test('clears only the listed role and keeps the personal perspective and the other role', async ({ request }) => {
    test.slow();
    const stamp = Date.now();
    const password = 'Secret123!';
    const tableId = `qa-persp-clear-001-${stamp}`;
    const perspectiveName = `Personal View ${stamp}`;
    const emailA = `qa-persp-clear-001-a-${stamp}@example.com`;
    const emailB = `qa-persp-clear-001-b-${stamp}@example.com`;

    let adminToken: string | null = null;
    let roleAId: string | null = null;
    let roleBId: string | null = null;
    let userAId: string | null = null;
    let userBId: string | null = null;
    let personalId: string | null = null;

    const memberSeesRole = async (token: string, roleId: string): Promise<boolean> => {
      const res = await apiRequest(request, 'GET', `/api/perspectives/${encodeURIComponent(tableId)}`, { token });
      expect(res.status()).toBe(200);
      const state = await readJsonSafe<StateResponse>(res);
      return (state?.rolePerspectives ?? []).some((rp) => rp.roleId === roleId);
    };

    try {
      adminToken = await getAuthToken(request, 'admin');
      const { organizationId } = getTokenContext(adminToken);

      const roleA = await createRoleFixture(request, adminToken, { name: `TC-PERSP-CLEAR-001 Role A ${stamp}` });
      const roleB = await createRoleFixture(request, adminToken, { name: `TC-PERSP-CLEAR-001 Role B ${stamp}` });
      roleAId = roleA;
      roleBId = roleB;
      userAId = await createUserFixture(request, adminToken, { email: emailA, password, organizationId, roles: [roleA] });
      userBId = await createUserFixture(request, adminToken, { email: emailB, password, organizationId, roles: [roleB] });
      await setUserAclVisibility(request, adminToken, { userId: userAId, features: ['perspectives.use'], organizations: [organizationId] });
      await setUserAclVisibility(request, adminToken, { userId: userBId, features: ['perspectives.use'], organizations: [organizationId] });
      const tokenA = await getAuthToken(request, emailA, password);
      const tokenB = await getAuthToken(request, emailB, password);

      // Seed personal + role perspectives for A and B in one request.
      const seed = await apiRequest(request, 'POST', `/api/perspectives/${encodeURIComponent(tableId)}`, {
        token: adminToken,
        data: { name: perspectiveName, settings: { pageSize: 15 }, applyToRoles: [roleA, roleB] },
      });
      expect(seed.status(), 'seed personal + roles A,B').toBe(200);
      const seedBody = await readJsonSafe<SaveResponse>(seed);
      personalId = seedBody?.perspective?.id ?? null;
      expect(typeof personalId, 'personal id present').toBe('string');
      const seedUpdatedAt = seedBody?.perspective?.updatedAt ?? null;
      expect(seedBody?.rolePerspectives ?? [], 'two role perspectives seeded').toHaveLength(2);

      expect(await memberSeesRole(tokenA, roleA), 'role A member sees perspective before clear').toBe(true);
      expect(await memberSeesRole(tokenB, roleB), 'role B member sees perspective before clear').toBe(true);

      // Re-save personal (same name) and clear ONLY role A in the same request.
      const cleared = await apiRequest(request, 'POST', `/api/perspectives/${encodeURIComponent(tableId)}`, {
        token: adminToken,
        data: { name: perspectiveName, settings: { pageSize: 18 }, clearRoleIds: [roleA] },
      });
      expect(cleared.status(), 'clearRoleIds POST').toBe(200);
      const clearedBody = await readJsonSafe<SaveResponse>(cleared);
      expect(clearedBody?.clearedRoleIds ?? [], 'response reports role A cleared').toEqual([roleA]);
      expect(clearedBody?.perspective?.id, 'personal perspective is the same record').toBe(personalId);

      // Personal perspective survives the clear and is updated in place.
      const adminState = await apiRequest(request, 'GET', `/api/perspectives/${encodeURIComponent(tableId)}`, { token: adminToken });
      expect(adminState.status()).toBe(200);
      const personalState = await readJsonSafe<StateResponse>(adminState);
      const personalMatches = (personalState?.perspectives ?? []).filter((perspective) => perspective.id === personalId);
      expect(personalMatches, 'exactly one personal perspective remains').toHaveLength(1);
      if (seedUpdatedAt && personalMatches[0].updatedAt) {
        expect(
          new Date(personalMatches[0].updatedAt).getTime(),
          'personal updatedAt advanced after re-save',
        ).toBeGreaterThanOrEqual(new Date(seedUpdatedAt).getTime());
      }

      // Role A cleared; role B untouched.
      expect(await memberSeesRole(tokenA, roleA), 'role A member no longer sees perspective').toBe(false);
      expect(await memberSeesRole(tokenB, roleB), 'role B member still sees perspective').toBe(true);
    } finally {
      if (adminToken && personalId) {
        await apiRequest(request, 'DELETE', `/api/perspectives/${encodeURIComponent(tableId)}/${personalId}`, { token: adminToken }).catch(() => {});
      }
      if (adminToken && roleBId) {
        await apiRequest(request, 'DELETE', `/api/perspectives/${encodeURIComponent(tableId)}/roles/${roleBId}`, { token: adminToken }).catch(() => {});
      }
      await deleteUserIfExists(request, adminToken, userAId);
      await deleteUserIfExists(request, adminToken, userBId);
      await deleteRoleIfExists(request, adminToken, roleAId);
      await deleteRoleIfExists(request, adminToken, roleBId);
    }
  });
});
