import { expect, type APIRequestContext } from '@playwright/test';
import { apiRequest } from './api';

export async function createDictionaryFixture(
  request: APIRequestContext,
  token: string,
  input: { key: string; name: string },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/dictionaries', {
    token,
    data: { key: input.key, name: input.name },
  });
  expect(response.ok(), `Failed to create dictionary fixture: ${response.status()}`).toBeTruthy();
  const body = (await response.json()) as { id?: string };
  expect(typeof body.id === 'string' && body.id.length > 0).toBeTruthy();
  return body.id as string;
}
