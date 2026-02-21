import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { apiRequest } from './api';

type JsonRecord = Record<string, unknown>;

export async function readJsonSafe<T = unknown>(response: APIResponse): Promise<T | null> {
  const raw = await response.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}

function findStringByKeys(value: unknown, keys: readonly string[]): string | null {
  if (!isRecord(value)) return null;

  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  for (const nested of Object.values(value)) {
    if (Array.isArray(nested)) continue;
    const found = findStringByKeys(nested, keys);
    if (found) return found;
  }

  return null;
}

async function createEntity(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
  idKeys: readonly string[],
): Promise<string> {
  const response = await apiRequest(request, 'POST', path, { token, data });
  const payload = await readJsonSafe(response);
  expect(response.ok(), `Failed POST ${path}: ${response.status()}`).toBeTruthy();
  const id = findStringByKeys(payload, idKeys);
  expect(id, `No id in ${path} response`).toBeTruthy();
  return id as string;
}

export async function createCompanyFixture(
  request: APIRequestContext,
  token: string,
  displayName: string,
): Promise<string> {
  return createEntity(request, token, '/api/customers/companies', { displayName }, ['id', 'entityId', 'companyId']);
}

export async function createPersonFixture(
  request: APIRequestContext,
  token: string,
  input: { firstName: string; lastName: string; displayName: string; companyEntityId?: string },
): Promise<string> {
  const data: Record<string, unknown> = {
    firstName: input.firstName,
    lastName: input.lastName,
    displayName: input.displayName,
  };
  if (input.companyEntityId) {
    data.companyEntityId = input.companyEntityId;
  }
  return createEntity(request, token, '/api/customers/people', data, ['id', 'entityId', 'personId']);
}

export async function createDealFixture(
  request: APIRequestContext,
  token: string,
  input: { title: string; companyIds?: string[]; personIds?: string[] },
): Promise<string> {
  const data: Record<string, unknown> = { title: input.title };
  if (input.companyIds?.length) data.companyIds = input.companyIds;
  if (input.personIds?.length) data.personIds = input.personIds;
  return createEntity(request, token, '/api/customers/deals', data, ['dealId', 'id', 'entityId']);
}

export async function deleteEntityIfExists(
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
