import { expect, type APIRequestContext } from '@playwright/test';
import { apiRequest } from './api';
import { expectId, readJsonSafe } from './generalFixtures';

export async function createRoleFixture(
  request: APIRequestContext,
  token: string,
  input: { name: string; tenantId?: string | null },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/auth/roles', {
    token,
    data: {
      name: input.name,
      tenantId: input.tenantId ?? null,
    },
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
  input: { email: string; password: string; organizationId: string; roles: string[] },
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
