import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { randomInt } from 'node:crypto';
import { apiRequest, getAuthToken, postForm } from '@open-mercato/core/helpers/integration/api';
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createOrganizationFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures';

const LAST_HOLDER_ERROR = 'Cannot remove the last active holder of role "admin"';

async function expectError(response: APIResponse, status: number, message: string): Promise<void> {
  expect(response.status()).toBe(status);
  const body = await readJsonSafe<{ error?: string }>(response);
  expect(body?.error).toContain(message);
}

async function updateConfirmation(
  request: APIRequestContext,
  token: string,
  userId: string,
  isConfirmed: boolean,
): Promise<APIResponse> {
  return apiRequest(request, 'PUT', '/api/auth/users', {
    token,
    data: { id: userId, isConfirmed },
  });
}

async function createTenant(request: APIRequestContext, token: string, name: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', {
    token,
    data: { name },
  });
  expect(response.status()).toBe(201);
  const body = await readJsonSafe<{ id?: string }>(response);
  return expectId(body?.id, 'Tenant create response should include id');
}

test.describe('TC-AUTH-054: Protected Role Floors and Deactivation Semantics', () => {
  test('enforces protected role floors, deactivation login block, and tenant isolation', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');

    const adminScope = getTokenScope(adminToken);
    const organizationId = expectId(adminScope.organizationId, 'Admin token should include organization id');
    const adminUserId = expectId(adminScope.userId, 'Admin token should include user id');

    const stamp = `${Date.now()}-${randomInt(1_000_000)}`;
    const secondAdminEmail = `admin-two-${stamp}@example.com`;
    const secondAdminPassword = 'StrongSecret123!';
    let secondAdminId: string | null = null;
    let foreignTenantId: string | null = null;
    let foreignOrganizationId: string | null = null;
    let foreignUserId: string | null = null;

    try {
      const removeRoleResponse = await apiRequest(request, 'PUT', '/api/auth/users', {
        token: adminToken,
        data: { id: adminUserId, roles: [] },
      });
      await expectError(removeRoleResponse, 400, LAST_HOLDER_ERROR);

      await expectError(
        await updateConfirmation(request, adminToken, adminUserId, false),
        400,
        LAST_HOLDER_ERROR,
      );

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/auth/users?id=${encodeURIComponent(adminUserId)}`,
        { token: adminToken },
      );
      await expectError(deleteResponse, 400, LAST_HOLDER_ERROR);

      secondAdminId = await createUserFixture(request, adminToken, {
        email: secondAdminEmail,
        password: secondAdminPassword,
        organizationId,
        roles: ['admin'],
      });
      const secondAdminToken = await getAuthToken(request, secondAdminEmail, secondAdminPassword);

      expect((await updateConfirmation(request, adminToken, secondAdminId, false)).status()).toBe(200);

      const existingSessionResponse = await apiRequest(request, 'GET', '/api/auth/profile', {
        token: secondAdminToken,
      });
      expect(existingSessionResponse.status()).toBe(401);

      const loginResponse = await postForm(request, '/api/auth/login', {
        email: secondAdminEmail,
        password: secondAdminPassword,
      });
      expect(loginResponse.status()).toBe(401);
      const loginBody = await readJsonSafe<{ error?: string }>(loginResponse);
      expect(loginBody?.error).toContain('Invalid email or password');

      expect((await updateConfirmation(request, superadminToken, secondAdminId, true)).status()).toBe(200);

      foreignTenantId = await createTenant(request, superadminToken, `TenantB-${stamp}`);
      foreignOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `OrgB-${stamp}`,
        tenantId: foreignTenantId,
      });
      foreignUserId = await createUserFixture(request, superadminToken, {
        email: `user-b-${stamp}@example.com`,
        password: secondAdminPassword,
        organizationId: foreignOrganizationId,
        roles: [],
      });

      const crossTenantDeleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/auth/users?id=${encodeURIComponent(foreignUserId)}`,
        { token: adminToken },
      );
      expect(crossTenantDeleteResponse.status()).toBe(404);

      const crossTenantUpdateResponse = await apiRequest(request, 'PUT', '/api/auth/users', {
        token: adminToken,
        data: { id: foreignUserId, roles: [] },
      });
      expect(crossTenantUpdateResponse.status()).toBe(404);

      const concurrentResponses = await Promise.all([
        updateConfirmation(request, superadminToken, adminUserId, false),
        updateConfirmation(request, superadminToken, secondAdminId, false),
      ]);
      expect(concurrentResponses.map((response) => response.status()).sort()).toEqual([200, 400]);
      const rejectedResponse = concurrentResponses.find((response) => response.status() === 400);
      if (!rejectedResponse) throw new Error('[internal] One concurrent deactivation should be rejected');
      await expectError(rejectedResponse, 400, LAST_HOLDER_ERROR);
    } finally {
      await updateConfirmation(request, superadminToken, adminUserId, true).catch(() => undefined);
      if (secondAdminId) {
        await updateConfirmation(request, superadminToken, secondAdminId, true).catch(() => undefined);
      }
      await deleteUserIfExists(request, superadminToken, foreignUserId);
      await deleteOrganizationIfExists(request, superadminToken, foreignOrganizationId);
      await deleteGeneralEntityIfExists(
        request,
        superadminToken,
        '/api/directory/tenants',
        foreignTenantId,
      );
      await deleteUserIfExists(request, superadminToken, secondAdminId);
    }
  });
});
