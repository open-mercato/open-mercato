import { expect, type APIRequestContext } from '@playwright/test';
import { apiRequest } from './api';
import { getTokenContext } from './generalFixtures';

export async function createCurrencyFixture(
  request: APIRequestContext,
  token: string,
  input: { code: string; name: string; symbol?: string },
): Promise<string> {
  const { organizationId, tenantId } = getTokenContext(token);
  const response = await apiRequest(request, 'POST', '/api/currencies/currencies', {
    token,
    data: { organizationId, tenantId, code: input.code, name: input.name, symbol: input.symbol ?? null },
  });
  expect(response.ok(), `Failed to create currency fixture: ${response.status()}`).toBeTruthy();
  const body = (await response.json()) as { id?: string };
  expect(typeof body.id === 'string' && body.id.length > 0).toBeTruthy();
  return body.id as string;
}

export async function createFetchConfigFixture(
  request: APIRequestContext,
  token: string,
  input: { provider: string; isEnabled: boolean },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/currencies/fetch-configs', {
    token,
    data: input,
  });
  expect(response.ok(), `Failed to create fetch config fixture: ${response.status()}`).toBeTruthy();
  const body = (await response.json()) as { config?: { id?: string } };
  const id = body.config?.id;
  expect(typeof id === 'string' && id.length > 0).toBeTruthy();
  return id as string;
}

export async function deleteCurrenciesEntityIfExists(
  request: APIRequestContext,
  token: string | null,
  path: string,
  id: string | null,
): Promise<void> {
  if (!token || !id) return;
  try {
    await apiRequest(request, 'DELETE', `${path}?id=${encodeURIComponent(id)}`, { token });
  } catch {
    return;
  }
}
