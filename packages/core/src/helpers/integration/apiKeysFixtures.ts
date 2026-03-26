import { expect, type APIRequestContext } from '@playwright/test';
import { apiRequest } from './api';

export async function createApiKeyFixture(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<{ id: string; secret: string }> {
  const response = await apiRequest(request, 'POST', '/api/api_keys/keys', {
    token,
    data: { name },
  });
  expect(response.ok(), `Failed to create API key fixture: ${response.status()}`).toBeTruthy();
  const body = (await response.json()) as { id?: string; secret?: string };
  expect(typeof body.id === 'string' && body.id.length > 0).toBeTruthy();
  return { id: body.id as string, secret: body.secret ?? '' };
}
