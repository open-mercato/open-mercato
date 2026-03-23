import { expect, type APIRequestContext } from '@playwright/test';
import { apiRequest } from './api';
import { expectId, readJsonSafe } from './generalFixtures';

export async function createRuleSetFixture(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/business_rules/sets', { token, data });
  const body = await readJsonSafe<{ id?: string }>(response);
  expect(response.status(), 'POST /api/business_rules/sets should return 201').toBe(201);
  return expectId(body?.id, 'Rule set creation response should include id');
}

export async function deleteRuleSetIfExists(
  request: APIRequestContext,
  token: string | null,
  ruleSetId: string | null,
): Promise<void> {
  if (!token || !ruleSetId) return;
  await apiRequest(
    request,
    'DELETE',
    `/api/business_rules/sets?id=${encodeURIComponent(ruleSetId)}`,
    { token },
  ).catch(() => undefined);
}

export async function createBusinessRuleFixture(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/business_rules/rules', { token, data });
  const body = await readJsonSafe<{ id?: string }>(response);
  expect(response.status(), 'POST /api/business_rules/rules should return 201').toBe(201);
  return expectId(body?.id, 'Business rule creation response should include id');
}

export async function deleteBusinessRuleIfExists(
  request: APIRequestContext,
  token: string | null,
  ruleId: string | null,
): Promise<void> {
  if (!token || !ruleId) return;
  await apiRequest(
    request,
    'DELETE',
    `/api/business_rules/rules?id=${encodeURIComponent(ruleId)}`,
    { token },
  ).catch(() => undefined);
}
