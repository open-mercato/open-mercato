import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

export type RecordLockSettings = {
  enabled: boolean;
  strategy: 'optimistic' | 'pessimistic';
  timeoutSeconds: number;
  heartbeatSeconds: number;
  enabledResources: string[];
  allowForceUnlock: boolean;
  notifyOnConflict: boolean;
};

export type RecordLockMutationResolution = 'normal' | 'accept_mine' | 'merged';

export type RecordLockMutationHeaders = {
  token?: string | null;
  baseLogId?: string | null;
  resolution?: RecordLockMutationResolution;
  conflictId?: string | null;
};

export type NotificationItem = {
  id: string;
  type: string;
  sourceEntityId?: string | null;
  bodyVariables?: Record<string, string>;
};

type ApiCallResult<TBody> = {
  response: APIResponse;
  status: number;
  body: TBody | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readJsonSafe(response: APIResponse): Promise<unknown> {
  const raw = await response.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

async function requestJson<TBody>(
  request: APIRequestContext,
  method: string,
  path: string,
  token: string,
  data?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<ApiCallResult<TBody>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...(extraHeaders ?? {}),
  };

  const response = await request.fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    data: data === undefined ? undefined : data,
  });

  const body = (await readJsonSafe(response)) as TBody | null;

  return {
    response,
    status: response.status(),
    body,
  };
}

export async function getRecordLockSettings(
  request: APIRequestContext,
  token: string,
): Promise<RecordLockSettings> {
  const result = await requestJson<{ settings?: RecordLockSettings }>(
    request,
    'GET',
    '/api/record_locks/settings',
    token,
  );

  expect(result.status).toBe(200);
  expect(result.body?.settings).toBeTruthy();

  return result.body?.settings as RecordLockSettings;
}

export async function saveRecordLockSettings(
  request: APIRequestContext,
  token: string,
  settings: RecordLockSettings,
): Promise<RecordLockSettings> {
  const result = await requestJson<{ settings?: RecordLockSettings }>(
    request,
    'POST',
    '/api/record_locks/settings',
    token,
    settings,
  );

  expect(result.status).toBe(200);
  expect(result.body?.settings).toBeTruthy();

  return result.body?.settings as RecordLockSettings;
}

export async function acquireRecordLock(
  request: APIRequestContext,
  token: string,
  resourceKind: string,
  resourceId: string,
  extraHeaders?: Record<string, string>,
): Promise<ApiCallResult<Record<string, unknown>>> {
  return requestJson<Record<string, unknown>>(
    request,
    'POST',
    '/api/record_locks/acquire',
    token,
    { resourceKind, resourceId },
    extraHeaders,
  );
}

export async function releaseRecordLock(
  request: APIRequestContext,
  token: string,
  resourceKind: string,
  resourceId: string,
  lockToken: string,
  reason: 'saved' | 'cancelled' | 'unmount' | 'conflict_resolved' = 'cancelled',
  options?: {
    conflictId?: string | null;
    resolution?: 'accept_incoming';
  },
  extraHeaders?: Record<string, string>,
): Promise<ApiCallResult<Record<string, unknown>>> {
  return requestJson<Record<string, unknown>>(
    request,
    'POST',
    '/api/record_locks/release',
    token,
    {
      resourceKind,
      resourceId,
      token: lockToken,
      reason,
      ...(options?.conflictId ? { conflictId: options.conflictId } : {}),
      ...(options?.resolution ? { resolution: options.resolution } : {}),
    },
    extraHeaders,
  );
}

export async function forceReleaseRecordLock(
  request: APIRequestContext,
  token: string,
  resourceKind: string,
  resourceId: string,
  reason?: string,
  extraHeaders?: Record<string, string>,
): Promise<ApiCallResult<Record<string, unknown>>> {
  return requestJson<Record<string, unknown>>(
    request,
    'POST',
    '/api/record_locks/force-release',
    token,
    {
      resourceKind,
      resourceId,
      ...(reason ? { reason } : {}),
    },
    extraHeaders,
  );
}

export async function updateCompany(
  request: APIRequestContext,
  token: string,
  companyId: string,
  displayName: string,
  lockHeaders?: RecordLockMutationHeaders,
  extraHeaders?: Record<string, string>,
): Promise<ApiCallResult<Record<string, unknown>>> {
  const requestHeaders: Record<string, string> = { ...(extraHeaders ?? {}) };

  if (lockHeaders) {
    requestHeaders['x-om-record-lock-kind'] = 'customers.company';
    requestHeaders['x-om-record-lock-resource-id'] = companyId;

    if (lockHeaders.token) {
      requestHeaders['x-om-record-lock-token'] = lockHeaders.token;
    }

    if (lockHeaders.baseLogId) {
      requestHeaders['x-om-record-lock-base-log-id'] = lockHeaders.baseLogId;
    }

    if (lockHeaders.resolution) {
      requestHeaders['x-om-record-lock-resolution'] = lockHeaders.resolution;
    }

    if (lockHeaders.conflictId) {
      requestHeaders['x-om-record-lock-conflict-id'] = lockHeaders.conflictId;
    }
  }

  return requestJson<Record<string, unknown>>(
    request,
    'PUT',
    '/api/customers/companies',
    token,
    {
      id: companyId,
      displayName,
    },
    requestHeaders,
  );
}

type JwtScopePayload = {
  tenantId?: string | null;
  orgId?: string | null;
};

export function buildScopeCookieFromToken(token: string): string | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;

  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as JwtScopePayload;
    const tenantId = typeof payload.tenantId === 'string' && payload.tenantId.trim().length > 0
      ? payload.tenantId.trim()
      : null;
    const orgId = typeof payload.orgId === 'string' && payload.orgId.trim().length > 0
      ? payload.orgId.trim()
      : null;

    const cookies: string[] = [];
    if (tenantId) cookies.push(`om_selected_tenant=${encodeURIComponent(tenantId)}`);
    if (orgId) cookies.push(`om_selected_org=${encodeURIComponent(orgId)}`);

    return cookies.length ? cookies.join('; ') : null;
  } catch {
    return null;
  }
}

export async function getCompanyDisplayName(
  request: APIRequestContext,
  token: string,
  companyId: string,
): Promise<string | null> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/customers/companies?id=${encodeURIComponent(companyId)}&pageSize=5`,
    { token },
  );

  expect(response.ok(), `Failed to read company ${companyId}: ${response.status()}`).toBeTruthy();

  const payload = (await readJsonSafe(response)) as { items?: Array<Record<string, unknown>> } | null;
  const rows = Array.isArray(payload?.items) ? payload.items : [];
  const row = rows.find((item) => typeof item.id === 'string' && item.id === companyId) ?? rows[0] ?? null;

  if (!row) return null;

  const snake = row.display_name;
  if (typeof snake === 'string') return snake;

  const camel = row.displayName;
  if (typeof camel === 'string') return camel;

  return null;
}

export async function listNotificationsByType(
  request: APIRequestContext,
  token: string,
  type: string,
): Promise<NotificationItem[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/notifications?type=${encodeURIComponent(type)}&pageSize=100`,
    { token },
  );

  expect(response.ok(), `Failed to list notifications: ${response.status()}`).toBeTruthy();

  const payload = (await readJsonSafe(response)) as { items?: unknown[] } | null;
  const items = Array.isArray(payload?.items) ? payload.items : [];

  return items.filter((entry): entry is NotificationItem => {
    if (!entry || typeof entry !== 'object') return false;
    const candidate = entry as Record<string, unknown>;
    return typeof candidate.id === 'string' && typeof candidate.type === 'string';
  });
}

export async function waitForNotification(
  request: APIRequestContext,
  token: string,
  type: string,
  predicate: (item: NotificationItem) => boolean,
  timeoutMs = 15_000,
  pollMs = 250,
): Promise<NotificationItem> {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const items = await listNotificationsByType(request, token, type);
    const found = items.find(predicate);
    if (found) return found;
    await sleep(pollMs);
  }

  throw new Error(`Notification ${type} not found within ${timeoutMs}ms`);
}

export async function cleanupCompany(
  request: APIRequestContext,
  token: string | null,
  companyId: string | null,
): Promise<void> {
  await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
}
