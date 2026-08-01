import { expect, test } from '@playwright/test';
import { randomInt } from 'node:crypto';
import { apiRequest, getAuthToken, postForm } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe, getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures';
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures';

test.describe('TC-AUTH-054: Protected Role Floors and Deactivation Semantics', () => {
  test('enforces protected role floors, deactivation login block, and tenant isolation', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');

    const adminScope = getTokenScope(adminToken);
    const orgId = adminScope.organizationId;
    const adminUserId = adminScope.userId;

    const stamp = `${Date.now()}-${randomInt(1_000_000)}`;

    // 1. Last admin removal: trying to remove the admin role from the current admin (who is the only admin)
    // should fail with 400.
    const removeRoleRes = await apiRequest(request, 'PUT', '/api/auth/users', {
      token: adminToken,
      data: {
        id: adminUserId,
        roles: [], // strip all roles
      },
    });
    expect(removeRoleRes.status()).toBe(400);
    const removeRoleBody = await readJsonSafe<{ error?: string }>(removeRoleRes);
    expect(removeRoleBody?.error).toContain('Cannot remove the last active holder of role "admin"');

    // 2. Deactivating the last admin: trying to update isConfirmed: false should fail with 400.
    const deactivateRes = await apiRequest(request, 'PUT', '/api/auth/users', {
      token: adminToken,
      data: {
        id: adminUserId,
        isConfirmed: false,
      },
    });
    expect(deactivateRes.status()).toBe(400);
    const deactivateBody = await readJsonSafe<{ error?: string }>(deactivateRes);
    expect(deactivateBody?.error).toContain('Cannot remove the last active holder of role "admin"');

    // 3. Deleting the last admin: trying to delete the current admin should fail with 400.
    const deleteRes = await apiRequest(request, 'DELETE', `/api/auth/users?id=${encodeURIComponent(adminUserId)}`, {
      token: adminToken,
    });
    expect(deleteRes.status()).toBe(400);
    const deleteBody = await readJsonSafe<{ error?: string }>(deleteRes);
    expect(deleteBody?.error).toContain('Cannot remove the last active holder of role "admin"');

    // 4. Create another admin user so we have 2 admin users. Then deactivation/deletion of one is allowed.
    const secondAdminEmail = `admin-two-${stamp}@example.com`;
    const secondAdminId = await createUserFixture(request, adminToken, {
      email: secondAdminEmail,
      password: 'StrongSecret123!',
      organizationId: orgId,
      roles: ['admin'],
    });

    try {
      // Deactivating one admin should succeed now because we have another active admin.
      const deactivateSecondRes = await apiRequest(request, 'PUT', '/api/auth/users', {
        token: adminToken,
        data: {
          id: secondAdminId,
          isConfirmed: false,
        },
      });
      expect(deactivateSecondRes.status()).toBe(200);

      // 5. Deactivation Login block: trying to login as the deactivated user should fail with 401.
      const loginRes = await postForm(request, '/api/auth/login', {
        email: secondAdminEmail,
        password: 'StrongSecret123!',
      });
      expect(loginRes.status()).toBe(401);
      const loginBody = await readJsonSafe<{ error?: string }>(loginRes);
      expect(loginBody?.error).toContain('Invalid email or password');

      // 6. Tenant Oracle Defense: a foreign scoped tenant should receive 404 instead of 400/403.
      // We will obtain a different tenant's admin token (e.g. from superadmin).
      const tenantBRes = await apiRequest(request, 'POST', '/api/directory/tenants', {
        token: superadminToken,
        data: { name: `TenantB-${stamp}` },
      });
      expect(tenantBRes.status()).toBe(201);
      const tenantBBody = await readJsonSafe<{ id: string }>(tenantBRes);
      const tenantBId = tenantBBody!.id;

      const orgBRes = await apiRequest(request, 'POST', '/api/directory/organizations', {
        token: superadminToken,
        data: { name: `OrgB-${stamp}`, tenantId: tenantBId },
      });
      expect(orgBRes.status()).toBe(201);
      const orgBBody = await readJsonSafe<{ id: string }>(orgBRes);
      const orgBId = orgBBody!.id;

      const userBId = await createUserFixture(request, superadminToken, {
        email: `user-b-${stamp}@example.com`,
        password: 'StrongSecret123!',
        organizationId: orgBId,
        roles: ['admin'],
      });

      // Now, try to delete or edit userB using tenant A's admin token. It must return 404.
      const crossTenantDeleteRes = await apiRequest(request, 'DELETE', `/api/auth/users?id=${encodeURIComponent(userBId)}`, {
        token: adminToken,
      });
      expect(crossTenantDeleteRes.status()).toBe(404);

      const crossTenantUpdateRes = await apiRequest(request, 'PUT', '/api/auth/users', {
        token: adminToken,
        data: {
          id: userBId,
          roles: [],
        },
      });
      expect(crossTenantUpdateRes.status()).toBe(404);

      // Cleanup Tenant B and User B
      await deleteUserIfExists(request, superadminToken, userBId);
      await apiRequest(request, 'DELETE', `/api/directory/organizations?id=${encodeURIComponent(orgBId)}`, {
        token: superadminToken,
      }).catch(() => undefined);
      await apiRequest(request, 'DELETE', `/api/directory/tenants?id=${encodeURIComponent(tenantBId)}`, {
        token: superadminToken,
      }).catch(() => undefined);

    } finally {
      // Cleanup second admin user
      await deleteUserIfExists(request, adminToken, secondAdminId);
    }
  });
});
