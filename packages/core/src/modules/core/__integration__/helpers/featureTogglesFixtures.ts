import { expect, type APIRequestContext } from '@playwright/test';
import { apiRequest } from './api';
import { expectId, readJsonSafe } from './generalFixtures';

export async function createFeatureToggleFixture(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/feature_toggles/global', { token, data });
  const body = await readJsonSafe<{ id?: string }>(response);
  expect(response.status(), 'POST /api/feature_toggles/global should return 201').toBe(201);
  return expectId(body?.id, 'Feature toggle creation response should include id');
}

export async function deleteFeatureToggleIfExists(
  request: APIRequestContext,
  token: string | null,
  toggleId: string | null,
): Promise<void> {
  if (!token || !toggleId) return;
  await apiRequest(
    request,
    'DELETE',
    `/api/feature_toggles/global?id=${encodeURIComponent(toggleId)}`,
    { token },
  ).catch(() => undefined);
}
