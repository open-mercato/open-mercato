import { expect, type APIRequestContext } from '@playwright/test';
import { apiRequest } from './api';

export function getTokenContext(token: string): { organizationId: string; tenantId: string } {
  const parts = token.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as { orgId?: string; tenantId?: string };
  return { organizationId: payload.orgId ?? '', tenantId: payload.tenantId ?? '' };
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
