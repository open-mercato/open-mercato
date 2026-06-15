import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures';

/**
 * TC-AUTH-ATOMIC-VERIFY: verifies the atomic-write refactor of auth / staff
 * (PR #2360 / issue #2339) is 100% backward-compatible and data-safe against a
 * real database.
 *
 * Endpoints covered:
 *   - POST   /api/auth/users                                 (create)
 *   - GET    /api/auth/users?id=                             (read)
 *   - DELETE /api/auth/users?id=                             (delete, cascade)
 *   - PUT    /api/auth/users/acl                             (user ACL write)
 *   - GET    /api/auth/users/acl?userId=                     (user ACL read)
 *   - PUT    /api/auth/roles/acl                             (role ACL write)
 *   - GET    /api/auth/roles/acl?roleId=                     (role ACL read)
 *   - POST   /api/audit_logs/audit-logs/actions/undo         (user-delete undo)
 *   - POST   /api/staff/team-members                         (create — best effort)
 *   - GET    /api/staff/team-members?ids=                    (read — best effort)
 *   - PUT    /api/staff/team-members                         (update — best effort)
 *   - DELETE /api/staff/team-members?id=                     (cleanup — best effort)
 *
 * Asserts:
 *   1. User-delete cascade (PR #2360 HIGH): creating a user with a role + a custom
 *      user-ACL override, then deleting it, atomically removes the user, its role
 *      link, and its UserAcl row (GET acl -> hasCustomAcl:false) while the role
 *      entity survives. The DELETE-issued undo token then restores the user *and*
 *      its role link *and* its custom ACL in one transaction.
 *   2. ACL routes backward-compat: PUT /api/auth/users/acl and PUT /api/auth/roles/acl
 *      persist { features, organizations } and read back identically via GET. These
 *      are direct atomic-flush writes (no undo token), so only field fidelity is
 *      asserted.
 *   3. staff team-members (best effort): create -> read -> update round-trips
 *      display_name / description / is_active; if the endpoint is unavailable the
 *      subcase skips with a reason rather than failing.
 *
 * Token note: user / role / ACL mutations were exercised with the `admin` actor,
 * whose organization scope matches the recorded action logs, so the user-delete
 * undo is reachable through the public undo API (verified live with curl).
 */

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  organizationId: string | null;
  tenantId: string | null;
  roles: string[];
  roleIds?: string[];
};

type UserAcl = {
  hasCustomAcl: boolean;
  isSuperAdmin: boolean;
  features: string[];
  organizations: string[] | null;
};

type RoleAcl = {
  isSuperAdmin: boolean;
  features: string[];
  organizations: string[] | null;
};

type TeamMemberRow = {
  id?: string | null;
  display_name?: string | null;
  description?: string | null;
  is_active?: boolean | null;
};

function readUndoToken(res: APIResponse): string {
  const enc = (res.headers()['x-om-operation'] ?? '').slice(5);
  expect(enc, 'x-om-operation header carries an omop: payload').not.toBe('');
  const payload = JSON.parse(decodeURIComponent(enc)) as { undoToken?: string };
  expect(typeof payload.undoToken, 'undoToken present in operation payload').toBe('string');
  return payload.undoToken as string;
}

async function getUserById(
  request: APIRequestContext,
  token: string,
  userId: string,
): Promise<UserRow | undefined> {
  const res = await apiRequest(request, 'GET', `/api/auth/users?id=${encodeURIComponent(userId)}`, { token });
  expect(res.status(), 'GET user returns 200').toBe(200);
  const body = await readJsonSafe<{ items?: UserRow[] }>(res);
  return (body?.items ?? []).find((row) => row.id === userId);
}

async function getUserAcl(request: APIRequestContext, token: string, userId: string): Promise<UserAcl> {
  const res = await apiRequest(request, 'GET', `/api/auth/users/acl?userId=${encodeURIComponent(userId)}`, { token });
  expect(res.status(), 'GET user acl returns 200').toBe(200);
  const body = await readJsonSafe<UserAcl>(res);
  expect(body, 'user acl body present').toBeTruthy();
  return body as UserAcl;
}

async function undo(request: APIRequestContext, token: string, undoToken: string): Promise<void> {
  const res = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/undo', {
    token,
    data: { undoToken },
  });
  expect(res.status(), 'undo returns 200').toBe(200);
  const body = await readJsonSafe<{ ok?: boolean }>(res);
  expect(body?.ok, 'undo body is { ok: true }').toBe(true);
}

test.describe('TC-AUTH-ATOMIC-VERIFY: auth / staff atomic refactor (PR #2360)', () => {
  test('user delete cascades ACL + role link, and the delete undo restores all of them', async ({ request }) => {
    let token: string | null = null;
    let roleId: string | null = null;
    let userId: string | null = null;
    const stamp = Date.now();

    try {
      token = await getAuthToken(request, 'admin');
      const { organizationId } = getTokenContext(token);
      expect(organizationId, 'admin token carries an organization id').toBeTruthy();

      roleId = await createRoleFixture(request, token, { name: `qa-atomic-verify-${stamp}` });
      userId = await createUserFixture(request, token, {
        email: `qa-atomic-verify-${stamp}@example.test`,
        password: 'Sup3rSecret!42',
        organizationId,
        roles: [roleId],
        name: `QA Atomic Verify ${stamp}`,
      });

      // Set -> read fidelity for the user and its role link.
      const created = await getUserById(request, token, userId);
      expect(created, 'created user is readable').toBeTruthy();
      expect(created!.email).toBe(`qa-atomic-verify-${stamp}@example.test`);
      expect(created!.name).toBe(`QA Atomic Verify ${stamp}`);
      expect(created!.organizationId).toBe(organizationId);
      expect(created!.roleIds ?? [], 'role assigned to user').toContain(roleId);

      // Give the user a custom ACL override so a UserAcl row exists to cascade.
      const aclFeatures = ['customers.companies.view'];
      const setAclRes = await apiRequest(request, 'PUT', '/api/auth/users/acl', {
        token,
        data: { userId, features: aclFeatures, organizations: [organizationId] },
      });
      expect(setAclRes.status(), 'set user acl returns 200').toBe(200);
      const aclBefore = await getUserAcl(request, token, userId);
      expect(aclBefore.hasCustomAcl, 'user has a custom acl before delete').toBe(true);
      expect(aclBefore.features, 'acl features persisted').toEqual(aclFeatures);
      expect(aclBefore.organizations, 'acl organizations persisted').toEqual([organizationId]);

      // Atomic delete: removes user + UserRole + UserAcl in one transaction.
      const deleteRes = await apiRequest(request, 'DELETE', `/api/auth/users?id=${encodeURIComponent(userId)}`, {
        token,
      });
      expect(deleteRes.status(), 'delete user returns 200').toBe(200);
      const deleteUndoToken = readUndoToken(deleteRes);

      // User gone.
      expect(await getUserById(request, token, userId), 'user removed after delete').toBeUndefined();
      // Custom ACL cascaded (no orphan UserAcl row).
      const aclAfterDelete = await getUserAcl(request, token, userId);
      expect(aclAfterDelete.hasCustomAcl, 'custom acl cascaded with the user').toBe(false);
      // Role entity itself untouched.
      const roleAfterDelete = await apiRequest(request, 'GET', `/api/auth/roles?id=${encodeURIComponent(roleId)}`, { token });
      expect(roleAfterDelete.status()).toBe(200);
      const roleBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(roleAfterDelete);
      expect((roleBody?.items ?? []).some((r) => r.id === roleId), 'role survives user delete').toBe(true);

      // Undo the delete: restores user + role link + custom ACL atomically.
      await undo(request, token, deleteUndoToken);
      const restored = await getUserById(request, token, userId);
      expect(restored, 'user restored after undo').toBeTruthy();
      expect(restored!.roleIds ?? [], 'role link restored on undo').toContain(roleId);
      const aclRestored = await getUserAcl(request, token, userId);
      expect(aclRestored.hasCustomAcl, 'custom acl restored on undo').toBe(true);
      expect(aclRestored.features, 'acl features restored on undo').toEqual(aclFeatures);
      expect(aclRestored.organizations, 'acl organizations restored on undo').toEqual([organizationId]);
    } finally {
      await deleteUserIfExists(request, token, userId);
      await deleteRoleIfExists(request, token, roleId);
    }
  });

  test('role ACL PUT route persists features and organizations (read-back fidelity)', async ({ request }) => {
    let token: string | null = null;
    let roleId: string | null = null;
    const stamp = Date.now();

    try {
      token = await getAuthToken(request, 'admin');
      const { organizationId } = getTokenContext(token);

      roleId = await createRoleFixture(request, token, { name: `qa-roleacl-${stamp}` });

      const features = ['customers.companies.view', 'catalog.products.view'];
      const putRes = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
        token,
        data: { roleId, features, organizations: [organizationId] },
      });
      expect(putRes.status(), 'role acl PUT returns 200').toBe(200);

      const getRes = await apiRequest(request, 'GET', `/api/auth/roles/acl?roleId=${encodeURIComponent(roleId)}`, { token });
      expect(getRes.status(), 'role acl GET returns 200').toBe(200);
      const acl = await readJsonSafe<RoleAcl>(getRes);
      expect(acl, 'role acl body present').toBeTruthy();
      expect(acl!.isSuperAdmin, 'role is not super admin').toBe(false);
      expect([...(acl!.features ?? [])].sort(), 'role acl features round-trip').toEqual([...features].sort());
      expect(acl!.organizations, 'role acl organizations round-trip').toEqual([organizationId]);
    } finally {
      await deleteRoleIfExists(request, token, roleId);
    }
  });

  test('staff team-member create -> read -> update round-trips (best effort)', async ({ request }) => {
    let token: string | null = null;
    let teamMemberId: string | null = null;
    const stamp = Date.now();

    try {
      token = await getAuthToken(request, 'admin');

      const createRes = await apiRequest(request, 'POST', '/api/staff/team-members', {
        token,
        data: { displayName: `QA Member ${stamp}`, description: 'original description', isActive: true },
      });
      // The staff module may not be enabled in every environment; skip cleanly.
      if (createRes.status() === 404) {
        test.skip(true, 'staff team-members endpoint unavailable (staff module not enabled)');
        return;
      }
      expect(createRes.status(), 'create team-member returns 201').toBe(201);
      teamMemberId = (await readJsonSafe<{ id?: string }>(createRes))?.id ?? null;
      expect(teamMemberId, 'team-member id returned').toBeTruthy();

      const readRes = await apiRequest(request, 'GET', `/api/staff/team-members?ids=${encodeURIComponent(teamMemberId!)}`, { token });
      expect(readRes.status(), 'read team-member returns 200').toBe(200);
      const created = (await readJsonSafe<{ items?: TeamMemberRow[] }>(readRes))?.items?.find((m) => m.id === teamMemberId);
      expect(created, 'created team-member readable').toBeTruthy();
      expect(created!.display_name).toBe(`QA Member ${stamp}`);
      expect(created!.description).toBe('original description');
      expect(created!.is_active).toBe(true);

      const updateRes = await apiRequest(request, 'PUT', '/api/staff/team-members', {
        token,
        data: { id: teamMemberId, displayName: `QA Member Renamed ${stamp}`, description: 'updated description', isActive: false },
      });
      expect(updateRes.status(), 'update team-member returns 200').toBe(200);

      const afterRes = await apiRequest(request, 'GET', `/api/staff/team-members?ids=${encodeURIComponent(teamMemberId!)}`, { token });
      expect(afterRes.status()).toBe(200);
      const updated = (await readJsonSafe<{ items?: TeamMemberRow[] }>(afterRes))?.items?.find((m) => m.id === teamMemberId);
      expect(updated?.display_name, 'displayName persisted').toBe(`QA Member Renamed ${stamp}`);
      expect(updated?.description, 'description persisted').toBe('updated description');
      expect(updated?.is_active, 'isActive persisted').toBe(false);
    } finally {
      if (token && teamMemberId) {
        await apiRequest(request, 'DELETE', `/api/staff/team-members?id=${encodeURIComponent(teamMemberId)}`, { token }).catch(
          () => undefined,
        );
      }
    }
  });
});
