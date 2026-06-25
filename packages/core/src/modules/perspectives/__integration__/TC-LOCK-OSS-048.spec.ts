import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { createRoleFixture, deleteRoleIfExists } from '@open-mercato/core/helpers/integration/authFixtures';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers';

export const integrationMeta = {
  dependsOnModules: ['perspectives'],
};

type PerspectiveDto = { id?: string; updatedAt?: string | null };
type RolePerspectiveDto = { id?: string; roleId?: string; updatedAt?: string | null };
type SaveResponse = {
  perspective?: PerspectiveDto;
  rolePerspectives?: RolePerspectiveDto[];
};
type StateResponse = {
  rolePerspectives?: RolePerspectiveDto[];
  manageableRolePerspectives?: RolePerspectiveDto[];
};

function authHeaders(token: string, expectedUpdatedAt?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (expectedUpdatedAt) headers[OPTIMISTIC_LOCK_HEADER_NAME] = expectedUpdatedAt;
  return headers;
}

async function savePerspective(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  tableId: string,
  data: Record<string, unknown>,
): Promise<SaveResponse> {
  const response = await apiRequest(request, 'POST', `/api/perspectives/${encodeURIComponent(tableId)}`, {
    token,
    data,
  });
  expect(response.status(), 'save perspective should return 200').toBe(200);
  const body = await readJsonSafe<SaveResponse>(response);
  expect(body, 'save perspective should return a JSON body').toBeTruthy();
  return body as SaveResponse;
}

async function loadPerspectiveState(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  tableId: string,
): Promise<StateResponse> {
  const response = await apiRequest(request, 'GET', `/api/perspectives/${encodeURIComponent(tableId)}`, { token });
  expect(response.status(), 'load perspective state should return 200').toBe(200);
  const body = await readJsonSafe<StateResponse>(response);
  expect(body, 'load perspective state should return a JSON body').toBeTruthy();
  return body as StateResponse;
}

function expectUpdatedAt(value: string | null | undefined, label: string): string {
  expect(typeof value, `${label} should expose updatedAt`).toBe('string');
  const iso = new Date(Date.parse(value as string)).toISOString();
  expect(Number.isFinite(Date.parse(iso)), `${label} updatedAt should parse`).toBe(true);
  return iso;
}

async function waitForTimestampTick() {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

async function expectConflict(response: Awaited<ReturnType<import('@playwright/test').APIRequestContext['fetch']>>) {
  expect(response.status(), 'stale perspective write should return 409').toBe(409);
  expect(await readJsonSafe<Record<string, unknown>>(response)).toMatchObject({
    code: 'optimistic_lock_conflict',
  });
}

test.describe('TC-LOCK-OSS-048: perspectives delete and role-default optimistic locking', () => {
  test('stale personal delete and role-default writes return structured 409 conflicts', async ({ request }) => {
    test.slow();

    const token = await getAuthToken(request, 'admin');
    const stamp = Date.now();
    const tableId = `qa-lock-oss-048-${stamp}`;
    const viewName = `QA Lock 048 ${stamp}`;
    const roleName = `TC-LOCK-OSS-048 Role ${stamp}`;

    let roleId: string | null = null;
    let personalId: string | null = null;

    try {
      roleId = await createRoleFixture(request, token, { name: roleName });

      const seed = await savePerspective(request, token, tableId, {
        name: viewName,
        settings: { pageSize: 20 },
        applyToRoles: [roleId],
        setRoleDefault: true,
      });
      personalId = seed.perspective?.id ?? null;
      expect(personalId, 'personal perspective id is returned').toBeTruthy();

      const personalT0 = expectUpdatedAt(seed.perspective?.updatedAt, 'personal perspective');
      const rolePerspective = (seed.rolePerspectives ?? []).find((item) => item.roleId === roleId);
      expect(rolePerspective, 'role perspective is returned').toBeTruthy();
      expect(rolePerspective?.id, 'role perspective id is returned').toBeTruthy();
      const roleT0 = expectUpdatedAt(rolePerspective?.updatedAt, 'role perspective');
      const initialState = await loadPerspectiveState(request, token, tableId);
      expect(
        (initialState.manageableRolePerspectives ?? []).some((item) => item.roleId === roleId && item.id === rolePerspective?.id),
        'manageable role perspectives expose rows for role-default lock tokens',
      ).toBe(true);

      await waitForTimestampTick();
      const bumpedPersonal = await savePerspective(request, token, tableId, {
        perspectiveId: personalId,
        name: viewName,
        settings: { pageSize: 21 },
        isDefault: false,
      });
      const personalT1 = expectUpdatedAt(bumpedPersonal.perspective?.updatedAt, 'bumped personal perspective');
      expect(personalT1, 'personal updatedAt should advance').not.toBe(personalT0);

      const stalePersonalDelete = await request.fetch(
        `/api/perspectives/${encodeURIComponent(tableId)}/${encodeURIComponent(personalId!)}`,
        {
          method: 'DELETE',
          headers: authHeaders(token, personalT0),
        },
      );
      await expectConflict(stalePersonalDelete);

      await waitForTimestampTick();
      const bumpedRole = await savePerspective(request, token, tableId, {
        name: viewName,
        settings: { pageSize: 22 },
        applyToRoles: [roleId],
        setRoleDefault: true,
        roleExpectedUpdatedAtByPerspectiveId: { [rolePerspective!.id!]: roleT0 },
      });
      const bumpedRolePerspective = (bumpedRole.rolePerspectives ?? []).find((item) => item.roleId === roleId);
      const roleT1 = expectUpdatedAt(bumpedRolePerspective?.updatedAt, 'bumped role perspective');
      expect(roleT1, 'role updatedAt should advance').not.toBe(roleT0);

      const staleRoleUpdate = await request.fetch(`/api/perspectives/${encodeURIComponent(tableId)}`, {
        method: 'POST',
        headers: authHeaders(token),
        data: {
          name: viewName,
          settings: { pageSize: 23 },
          applyToRoles: [roleId],
          setRoleDefault: true,
          roleExpectedUpdatedAtByRoleId: { [roleId]: roleT0 },
        },
      });
      await expectConflict(staleRoleUpdate);

      await waitForTimestampTick();
      const defaultName = `${viewName} Default`;
      const newDefault = await savePerspective(request, token, tableId, {
        name: defaultName,
        settings: { pageSize: 24 },
        applyToRoles: [roleId],
        setRoleDefault: true,
        roleExpectedUpdatedAtByPerspectiveId: { [bumpedRolePerspective!.id!]: roleT1 },
      });
      const defaultRolePerspective = (newDefault.rolePerspectives ?? []).find((item) => item.roleId === roleId);
      expect(defaultRolePerspective?.id, 'new default role perspective id is returned').toBeTruthy();
      const defaultT0 = expectUpdatedAt(defaultRolePerspective?.updatedAt, 'new default role perspective');

      await waitForTimestampTick();
      const bumpedDefault = await savePerspective(request, token, tableId, {
        name: defaultName,
        settings: { pageSize: 25 },
        applyToRoles: [roleId],
        setRoleDefault: true,
        roleExpectedUpdatedAtByPerspectiveId: { [defaultRolePerspective!.id!]: defaultT0 },
      });
      const defaultT1 = expectUpdatedAt(
        (bumpedDefault.rolePerspectives ?? []).find((item) => item.roleId === roleId)?.updatedAt,
        'bumped default role perspective',
      );
      expect(defaultT1, 'default role updatedAt should advance').not.toBe(defaultT0);

      const stalePreviousDefaultClear = await request.fetch(`/api/perspectives/${encodeURIComponent(tableId)}`, {
        method: 'POST',
        headers: authHeaders(token),
        data: {
          name: viewName,
          settings: { pageSize: 26 },
          applyToRoles: [roleId],
          setRoleDefault: true,
          roleExpectedUpdatedAtByPerspectiveId: {
            [bumpedRolePerspective!.id!]: roleT1,
            [defaultRolePerspective!.id!]: defaultT0,
          },
        },
      });
      await expectConflict(stalePreviousDefaultClear);

      const staleRoleClear = await request.fetch(
        `/api/perspectives/${encodeURIComponent(tableId)}/roles/${encodeURIComponent(roleId)}`,
        {
          method: 'DELETE',
          headers: authHeaders(token, roleT0),
        },
      );
      await expectConflict(staleRoleClear);

      const clearState = await loadPerspectiveState(request, token, tableId);
      const clearVersions = Object.fromEntries(
        (clearState.manageableRolePerspectives ?? [])
          .filter((item) => item.roleId === roleId && item.id && item.updatedAt)
          .map((item) => [item.id!, item.updatedAt!]),
      );
      expect(Object.keys(clearVersions).length, 'role clear should send every row version').toBeGreaterThanOrEqual(2);
      const currentRoleClear = await request.fetch(
        `/api/perspectives/${encodeURIComponent(tableId)}/roles/${encodeURIComponent(roleId)}`,
        {
          method: 'DELETE',
          headers: authHeaders(token),
          data: { roleExpectedUpdatedAtByPerspectiveId: clearVersions },
        },
      );
      expect(currentRoleClear.status(), 'current per-row role clear should return 200').toBe(200);
    } finally {
      if (token && personalId) {
        await request.fetch(
          `/api/perspectives/${encodeURIComponent(tableId)}/${encodeURIComponent(personalId)}`,
          { method: 'DELETE', headers: authHeaders(token) },
        ).catch(() => undefined);
      }
      if (token && roleId) {
        await request.fetch(
          `/api/perspectives/${encodeURIComponent(tableId)}/roles/${encodeURIComponent(roleId)}`,
          { method: 'DELETE', headers: authHeaders(token) },
        ).catch(() => undefined);
      }
      await deleteRoleIfExists(request, token, roleId);
    }
  });
});
