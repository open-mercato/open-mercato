import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { apiRequest } from './api';

function readTokenPayload(token: string): { orgId?: string; tenantId?: string; sub?: string } {
  const parts = token.split('.');
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as {
    orgId?: string;
    tenantId?: string;
    sub?: string;
  };
}

export function getTokenContext(token: string): { organizationId: string; tenantId: string } {
  const payload = readTokenPayload(token);
  return { organizationId: payload.orgId ?? '', tenantId: payload.tenantId ?? '' };
}

export function getTokenScope(token: string): {
  organizationId: string;
  tenantId: string;
  userId: string;
} {
  const payload = readTokenPayload(token);
  return {
    organizationId: payload.orgId ?? '',
    tenantId: payload.tenantId ?? '',
    userId: payload.sub ?? '',
  };
}

export async function readJsonSafe<T = unknown>(response: APIResponse): Promise<T | null> {
  const raw = await response.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function expectId(value: unknown, message: string): string {
  expect(typeof value === 'string' && value.length > 0, message).toBe(true);
  return value as string;
}

export async function deleteEntityByPathIfExists(
  request: APIRequestContext,
  token: string | null,
  fullPath: string | null,
): Promise<void> {
  if (!token || !fullPath) return;
  try {
    await apiRequest(request, 'DELETE', fullPath, { token });
  } catch {
    return;
  }
}

export async function deleteGeneralEntityIfExists(
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
