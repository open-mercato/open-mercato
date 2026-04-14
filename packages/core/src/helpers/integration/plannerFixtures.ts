import { expect, type APIRequestContext } from '@playwright/test';
import { apiRequest } from './api';
import { expectId, readJsonSafe } from './generalFixtures';

export async function createAvailabilityRuleSetFixture(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/planner/availability-rule-sets', { token, data });
  const body = await readJsonSafe<{ id?: string }>(response);
  expect(response.status(), 'POST /api/planner/availability-rule-sets should return 201').toBe(201);
  return expectId(body?.id, 'Availability rule set creation response should include id');
}

export async function deleteAvailabilityRuleSetIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return;
  await apiRequest(
    request,
    'DELETE',
    `/api/planner/availability-rule-sets?id=${encodeURIComponent(id)}`,
    { token },
  ).catch(() => undefined);
}

export async function createAvailabilityRuleFixture(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/planner/availability', { token, data });
  const body = await readJsonSafe<{ id?: string }>(response);
  expect(response.status(), 'POST /api/planner/availability should return 201').toBe(201);
  return expectId(body?.id, 'Availability rule creation response should include id');
}

export async function deleteAvailabilityRuleIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return;
  await apiRequest(
    request,
    'DELETE',
    `/api/planner/availability?id=${encodeURIComponent(id)}`,
    { token },
  ).catch(() => undefined);
}
