import { expect, type APIRequestContext } from '@playwright/test';
import { apiRequest } from './api';

type JsonMap = Record<string, unknown>;

function readId(payload: unknown, keys: string[]): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const map = payload as JsonMap;
  for (const key of keys) {
    const value = map[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  for (const value of Object.values(map)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = readId(value, keys);
      if (nested) return nested;
    }
  }
  return null;
}

async function createEntity(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
  idKeys: string[],
): Promise<string> {
  const response = await apiRequest(request, 'POST', path, { token, data });
  const body = (await response.json()) as unknown;
  expect(response.ok(), `Failed POST ${path}: ${response.status()}`).toBeTruthy();
  const id = readId(body, idKeys);
  expect(id, `No id in POST ${path} response`).toBeTruthy();
  return id as string;
}

export async function createSalesQuoteFixture(
  request: APIRequestContext,
  token: string,
  currencyCode = 'USD',
): Promise<string> {
  return createEntity(request, token, '/api/sales/quotes', { currencyCode }, ['id', 'quoteId']);
}

export async function createSalesOrderFixture(
  request: APIRequestContext,
  token: string,
  currencyCode = 'USD',
): Promise<string> {
  return createEntity(request, token, '/api/sales/orders', { currencyCode }, ['id', 'orderId']);
}

export async function createOrderLineFixture(
  request: APIRequestContext,
  token: string,
  orderId: string,
  data?: Record<string, unknown>,
): Promise<string> {
  return createEntity(
    request,
    token,
    '/api/sales/order-lines',
    {
      orderId,
      currencyCode: 'USD',
      quantity: 1,
      name: `QA line ${Date.now()}`,
      unitPriceNet: 10,
      unitPriceGross: 12,
      ...(data ?? {}),
    },
    ['id', 'lineId'],
  );
}

export async function deleteSalesEntityIfExists(
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

