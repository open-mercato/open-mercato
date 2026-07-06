import { expect, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from './api';
import { expectId, readJsonSafe } from './generalFixtures';

// Re-exported so tests can import auth helpers from a single fixtures module.
export { getAuthToken };

const BASE_URL = process.env.BASE_URL?.trim() || null;

function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path;
}

/**
 * Variant of {@link apiRequest} that sets the `om_selected_org` cookie so the
 * server resolves `ctx.selectedOrganizationId` to a specific organization.
 * Create routes scope new records to that organization, which lets a test place
 * a fixture in an organization other than the caller's home org.
 */
export async function apiRequestWithSelectedOrg(
  request: APIRequestContext,
  method: string,
  path: string,
  options: { token: string; selectedOrgId: string; data?: unknown },
) {
  const headers = {
    Authorization: `Bearer ${options.token}`,
    'Content-Type': 'application/json',
    Cookie: `om_selected_org=${options.selectedOrgId}`,
  };
  return request.fetch(resolveUrl(path), { method, headers, data: options.data });
}

export async function createRoleFixture(
  request: APIRequestContext,
  token: string,
  input: { name: string; tenantId?: string },
): Promise<string> {
  const payload: { name: string; tenantId?: string } = {
    name: input.name,
  };
  if (typeof input.tenantId === 'string' && input.tenantId.length > 0) {
    payload.tenantId = input.tenantId;
  }
  const response = await apiRequest(request, 'POST', '/api/auth/roles', {
    token,
    data: payload,
  });
  const body = await readJsonSafe<{ id?: string }>(response);
  expect(response.status(), 'POST /api/auth/roles should return 201').toBe(201);
  return expectId(body?.id, 'Role creation response should include id');
}

export async function deleteRoleIfExists(
  request: APIRequestContext,
  token: string | null,
  roleId: string | null,
): Promise<void> {
  if (!token || !roleId) return;
  await apiRequest(request, 'DELETE', `/api/auth/roles?id=${encodeURIComponent(roleId)}`, { token }).catch(() => undefined);
}

export async function createUserFixture(
  request: APIRequestContext,
  token: string,
  input: { email: string; password: string; organizationId: string; roles: string[]; name?: string },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/auth/users', {
    token,
    data: input,
  });
  const body = await readJsonSafe<{ id?: string }>(response);
  expect(response.status(), 'POST /api/auth/users should return 201').toBe(201);
  return expectId(body?.id, 'User creation response should include id');
}

export async function deleteUserIfExists(
  request: APIRequestContext,
  token: string | null,
  userId: string | null,
): Promise<void> {
  if (!token || !userId) return;
  await apiRequest(request, 'DELETE', `/api/auth/users?id=${encodeURIComponent(userId)}`, { token }).catch(() => undefined);
}

export async function createOrganizationFixture(
  request: APIRequestContext,
  token: string,
  input: { name: string; tenantId?: string },
): Promise<string> {
  const payload: { name: string; tenantId?: string } = { name: input.name };
  if (typeof input.tenantId === 'string' && input.tenantId.length > 0) {
    payload.tenantId = input.tenantId;
  }
  const response = await apiRequest(request, 'POST', '/api/directory/organizations', {
    token,
    data: payload,
  });
  const body = await readJsonSafe<{ id?: string }>(response);
  expect(response.status(), 'POST /api/directory/organizations should return 201').toBe(201);
  return expectId(body?.id, 'Organization creation response should include id');
}

export async function deleteOrganizationIfExists(
  request: APIRequestContext,
  token: string | null,
  organizationId: string | null,
): Promise<void> {
  if (!token || !organizationId) return;
  await apiRequest(request, 'DELETE', '/api/directory/organizations', {
    token,
    data: { id: organizationId },
  }).catch(() => undefined);
}

export async function setRoleAclFeatures(
  request: APIRequestContext,
  token: string,
  input: { roleId: string; features: string[]; organizations?: string[] | null },
): Promise<void> {
  const payload: { roleId: string; features: string[]; organizations?: string[] | null } = {
    roleId: input.roleId,
    features: input.features,
  };
  if (input.organizations !== undefined) {
    payload.organizations = input.organizations;
  }
  const response = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
    token,
    data: payload,
  });
  const body = await readJsonSafe<{ ok?: boolean }>(response);
  expect(response.status(), 'PUT /api/auth/roles/acl should return 200').toBe(200);
  expect(body?.ok, 'Role ACL update should report ok=true').toBe(true);
}

export async function setUserAclVisibility(
  request: APIRequestContext,
  token: string,
  input: { userId: string; organizations: string[] | null; features?: string[] },
): Promise<void> {
  const payload: { userId: string; organizations: string[] | null; features?: string[] } = {
    userId: input.userId,
    organizations: input.organizations,
  };
  if (input.features !== undefined) {
    payload.features = input.features;
  }
  const response = await apiRequest(request, 'PUT', '/api/auth/users/acl', {
    token,
    data: payload,
  });
  const body = await readJsonSafe<{ ok?: boolean }>(response);
  expect(response.status(), 'PUT /api/auth/users/acl should return 200').toBe(200);
  expect(body?.ok, 'User ACL update should report ok=true').toBe(true);
}
