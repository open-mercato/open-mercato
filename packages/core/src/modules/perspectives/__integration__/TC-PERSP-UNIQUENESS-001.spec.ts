import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

export const integrationMeta = {
  dependsOnModules: ['perspectives', 'auth'],
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SaveResponse = {
  perspective?: { id?: string; name?: string };
  rolePerspectives?: Array<{ id?: string; roleId?: string; name?: string }>;
};
type StateResponse = {
  rolePerspectives?: Array<{ roleId?: string; name?: string }>;
};

/**
 * TC-PERSP-UNIQUENESS-001 (#3277): soft-deleted saved views do not reserve names.
 *
 * Perspective and RolePerspective rows are soft-deleted via deleted_at. The database
 * uniqueness contract must apply only to live rows while still rejecting active-name
 * collisions in the same tenant/organization scope.
 */
test.describe('TC-PERSP-UNIQUENESS-001: saved view live-row uniqueness', () => {
  test('recreates a deleted personal view with the same name', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = Date.now();
    const tableId = `qa-persp-unique-personal-${stamp}`;
    const name = `QA Recreate ${stamp}`;
    const createdIds: string[] = [];

    try {
      const first = await apiRequest(request, 'POST', `/api/perspectives/${encodeURIComponent(tableId)}`, {
        token,
        data: { name, settings: { pageSize: 20 } },
      });
      expect(first.status(), 'first personal view create').toBe(200);
      const firstBody = await readJsonSafe<SaveResponse>(first);
      const firstId = firstBody?.perspective?.id ?? null;
      expect(typeof firstId === 'string' && UUID_RE.test(firstId), 'first id is a UUID').toBe(true);
      createdIds.push(firstId as string);

      const deleted = await apiRequest(request, 'DELETE', `/api/perspectives/${encodeURIComponent(tableId)}/${firstId}`, { token });
      expect(deleted.status(), 'soft delete personal view').toBe(200);

      const second = await apiRequest(request, 'POST', `/api/perspectives/${encodeURIComponent(tableId)}`, {
        token,
        data: { name, settings: { pageSize: 50 } },
      });
      expect(second.status(), 'recreate with same name after delete').toBe(200);
      const secondBody = await readJsonSafe<SaveResponse>(second);
      const secondId = secondBody?.perspective?.id ?? null;
      expect(typeof secondId === 'string' && UUID_RE.test(secondId), 'second id is a UUID').toBe(true);
      expect(secondId, 'recreate creates a new live row').not.toBe(firstId);
      expect(secondBody?.perspective?.name).toBe(name);
      createdIds.push(secondId as string);
    } finally {
      for (const id of createdIds) {
        await apiRequest(request, 'DELETE', `/api/perspectives/${encodeURIComponent(tableId)}/${encodeURIComponent(id)}`, { token }).catch(() => {});
      }
    }
  });

  test('recreates a deleted role view with the same name', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const { organizationId } = getTokenContext(token);
    const stamp = Date.now();
    const tableId = `qa-persp-unique-role-${stamp}`;
    const name = `QA Shared Recreate ${stamp}`;
    const password = 'Secret123!';
    const memberEmail = `qa-persp-unique-role-${stamp}@example.com`;
    let roleId: string | null = null;
    let memberId: string | null = null;
    let personalId: string | null = null;

    try {
      roleId = await createRoleFixture(request, token, { name: `TC-PERSP-UNIQUENESS Role ${stamp}` });
      memberId = await createUserFixture(request, token, {
        email: memberEmail,
        password,
        organizationId,
        roles: [roleId],
      });
      await setUserAclVisibility(request, token, {
        userId: memberId,
        features: ['perspectives.use'],
        organizations: [organizationId],
      });
      const memberToken = await getAuthToken(request, memberEmail, password);

      const first = await apiRequest(request, 'POST', `/api/perspectives/${encodeURIComponent(tableId)}`, {
        token,
        data: { name, settings: { pageSize: 25 }, applyToRoles: [roleId], setRoleDefault: true },
      });
      expect(first.status(), 'first role view create').toBe(200);
      const firstBody = await readJsonSafe<SaveResponse>(first);
      personalId = firstBody?.perspective?.id ?? null;

      const before = await apiRequest(request, 'GET', `/api/perspectives/${encodeURIComponent(tableId)}`, { token: memberToken });
      expect(before.status(), 'member can load first role view').toBe(200);
      const beforeState = await readJsonSafe<StateResponse>(before);
      expect(
        (beforeState?.rolePerspectives ?? []).filter((item) => item.roleId === roleId && item.name === name),
        'member sees first role perspective',
      ).toHaveLength(1);

      const deleted = await apiRequest(
        request,
        'DELETE',
        `/api/perspectives/${encodeURIComponent(tableId)}/roles/${encodeURIComponent(roleId)}`,
        { token },
      );
      expect(deleted.status(), 'soft delete role view').toBe(200);

      const second = await apiRequest(request, 'POST', `/api/perspectives/${encodeURIComponent(tableId)}`, {
        token,
        data: { name, settings: { pageSize: 75 }, applyToRoles: [roleId], setRoleDefault: true },
      });
      expect(second.status(), 'recreate role view with same name after delete').toBe(200);
      const after = await apiRequest(request, 'GET', `/api/perspectives/${encodeURIComponent(tableId)}`, { token: memberToken });
      expect(after.status(), 'member can load recreated role view').toBe(200);
      const afterState = await readJsonSafe<StateResponse>(after);
      expect(
        (afterState?.rolePerspectives ?? []).filter((item) => item.roleId === roleId && item.name === name),
        'member sees recreated role perspective',
      ).toHaveLength(1);
    } finally {
      if (roleId) {
        await apiRequest(
          request,
          'DELETE',
          `/api/perspectives/${encodeURIComponent(tableId)}/roles/${encodeURIComponent(roleId)}`,
          { token },
        ).catch(() => {});
      }
      if (personalId) {
        await apiRequest(request, 'DELETE', `/api/perspectives/${encodeURIComponent(tableId)}/${encodeURIComponent(personalId)}`, { token }).catch(() => {});
      }
      await deleteUserIfExists(request, token, memberId);
      await deleteRoleIfExists(request, token, roleId);
    }
  });

  test('rejects renaming a personal view to another active name in the same scope', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = Date.now();
    const tableId = `qa-persp-unique-active-${stamp}`;
    const firstName = `QA Active A ${stamp}`;
    const secondName = `QA Active B ${stamp}`;
    const createdIds: string[] = [];

    const create = async (name: string): Promise<string> => {
      const response = await apiRequest(request, 'POST', `/api/perspectives/${encodeURIComponent(tableId)}`, {
        token,
        data: { name, settings: { pageSize: 20 } },
      });
      expect(response.status(), `create ${name}`).toBe(200);
      const body = await readJsonSafe<SaveResponse>(response);
      const id = body?.perspective?.id ?? null;
      expect(typeof id === 'string' && UUID_RE.test(id), 'created id is a UUID').toBe(true);
      createdIds.push(id as string);
      return id as string;
    };

    try {
      await create(firstName);
      const secondId = await create(secondName);

      const duplicateRename = await apiRequest(request, 'POST', `/api/perspectives/${encodeURIComponent(tableId)}`, {
        token,
        data: { perspectiveId: secondId, name: firstName, settings: { pageSize: 40 } },
      });
      expect(duplicateRename.status(), 'rename to active duplicate should return 409').toBe(409);
      const body = await readJsonSafe<{ error?: string; code?: string }>(duplicateRename);
      expect(body?.code).toBe('duplicate_name');
    } finally {
      for (const id of createdIds) {
        await apiRequest(request, 'DELETE', `/api/perspectives/${encodeURIComponent(tableId)}/${encodeURIComponent(id)}`, { token }).catch(() => {});
      }
    }
  });
});
