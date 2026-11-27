import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { createRoleFixture, deleteRoleIfExists } from '@open-mercato/core/helpers/integration/authFixtures';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

export const integrationMeta = {
  dependsOnModules: ['perspectives'],
};

type RolePerspectiveDto = { id?: string; roleId?: string; name?: string; updatedAt?: string | null; settings?: Record<string, unknown> };
type SaveResponse = { perspective?: { id?: string }; rolePerspectives?: RolePerspectiveDto[]; code?: string };
type StateResponse = { perspectives?: Array<{ id?: string; name?: string }> };

/**
 * TC-PERSP-CLONE-ROLE-001 (#8632): a create-only save never overwrites an existing role view.
 *
 * The Views panel's Clone sends `createOnly: true` and pushes the copy to the source view's
 * roles. A role view already named like the copy (e.g. shared earlier by someone else) must
 * not be updated in place: the request is rejected with 409 `duplicate_name` and nothing is
 * committed — neither the personal copy nor a change to the existing role view.
 */
test.describe('TC-PERSP-CLONE-ROLE-001: create-only clone does not replace a same-named role view', () => {
  test('rejects the clone with 409 and leaves the existing role view and personal list untouched', async ({ request }) => {
    test.slow();
    const token = await getAuthToken(request, 'admin');
    const stamp = Date.now();
    const tableId = `qa-persp-clone-role-${stamp}`;
    const copyName = `Pipeline ${stamp} (copy)`;
    const originalSettings = { pageSize: 21, searchValue: `original-${stamp}` };
    const cloneSettings = { pageSize: 42, searchValue: `clone-${stamp}` };
    const base = `/api/perspectives/${encodeURIComponent(tableId)}`;

    let roleId: string | null = null;
    const personalIds: string[] = [];

    try {
      roleId = await createRoleFixture(request, token, { name: `TC-PERSP-CLONE-ROLE-001 ${stamp}` });

      const seedRes = await apiRequest(request, 'POST', base, {
        token,
        data: { name: copyName, settings: originalSettings, applyToRoles: [roleId] },
      });
      expect(seedRes.status(), 'seed shared role view').toBe(200);
      const seed = await readJsonSafe<SaveResponse>(seedRes);
      const seededPersonalId = seed?.perspective?.id ?? null;
      const existingRoleView = (seed?.rolePerspectives ?? []).find((rp) => rp.roleId === roleId);
      expect(existingRoleView?.id, 'seeded role view id').toBeTruthy();
      expect(existingRoleView?.updatedAt, 'seeded role view version').toBeTruthy();

      if (seededPersonalId) {
        personalIds.push(seededPersonalId);
        const deleteRes = await apiRequest(request, 'DELETE', `${base}/${seededPersonalId}`, { token });
        expect(deleteRes.ok(), 'drop the personal twin so only the role view keeps the name').toBeTruthy();
      }

      const cloneRes = await apiRequest(request, 'POST', base, {
        token,
        data: {
          name: copyName,
          settings: cloneSettings,
          applyToRoles: [roleId],
          createOnly: true,
          roleExpectedUpdatedAtByPerspectiveId: { [existingRoleView!.id as string]: existingRoleView!.updatedAt },
        },
      });
      expect(cloneRes.status(), 'create-only clone onto a taken role name').toBe(409);
      const cloneBody = await readJsonSafe<SaveResponse>(cloneRes);
      expect(cloneBody?.code).toBe('duplicate_name');

      const stateRes = await apiRequest(request, 'GET', base, { token });
      expect(stateRes.status()).toBe(200);
      const state = await readJsonSafe<StateResponse>(stateRes);
      const personalMatches = (state?.perspectives ?? []).filter((item) => item.name === copyName);
      expect(personalMatches, 'the rejected clone committed no personal copy').toHaveLength(0);

      const verifyRes = await apiRequest(request, 'POST', base, {
        token,
        data: {
          name: copyName,
          settings: originalSettings,
          applyToRoles: [roleId],
          roleExpectedUpdatedAtByPerspectiveId: { [existingRoleView!.id as string]: existingRoleView!.updatedAt },
        },
      });
      expect(verifyRes.status(), 'the role view still carries its original version').toBe(200);
      const verify = await readJsonSafe<SaveResponse>(verifyRes);
      if (verify?.perspective?.id) personalIds.push(verify.perspective.id);
      const roleView = (verify?.rolePerspectives ?? []).find((rp) => rp.roleId === roleId);
      expect(roleView?.id, 'the same role view was matched, not duplicated').toBe(existingRoleView!.id);
    } finally {
      for (const personalId of personalIds) {
        await apiRequest(request, 'DELETE', `${base}/${personalId}`, { token }).catch(() => {});
      }
      if (roleId) {
        await apiRequest(request, 'DELETE', `${base}/roles/${roleId}`, { token }).catch(() => {});
      }
      await deleteRoleIfExists(request, token, roleId);
    }
  });
});
