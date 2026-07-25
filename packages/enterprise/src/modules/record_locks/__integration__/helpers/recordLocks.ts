import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { getTokenContext } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

export type RecordLockSettings = {
  enabled: boolean;
  strategy: 'optimistic' | 'pessimistic';
  timeoutSeconds: number;
  heartbeatSeconds: number;
  enabledResources: string[];
  allowForceUnlock: boolean;
  allowIncomingOverride?: boolean;
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
  status?: 'unread' | 'read' | 'actioned' | 'dismissed';
  actions?: Array<{
    id: string;
    label?: string;
    labelKey?: string;
  }>;
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

// Fixture setup against the shared ephemeral env occasionally races the
// Postgres connection budget when the FULL record_locks suite (~44 specs +
// background queue workers) runs against one database: peak demand briefly
// exceeds `max_connections`, so an in-flight create can't get a connection and
// the CRUD layer masks the `FATAL: sorry, too many clients already` as a generic
// 500. That is a transient infrastructure hiccup, never a lock-semantics signal,
// so FIXTURE creates retry a transient 5xx with capped backoff. Lock-assertion
// mutations (the stale→409 / fresh→2xx PUTs) deliberately do NOT retry — they
// must observe the real first response.
// The connection-budget spike during the full suite can last several seconds
// (hundreds of `too many clients` rejections back-to-back), so the retry window
// is sized to comfortably outlast it: 7 attempts with capped backoff + jitter
// ≈ 12s total. Jitter de-synchronizes retries from the background queue fleet
// that competes for the same pool.
const TRANSIENT_CREATE_RETRIES = 7;
const TRANSIENT_BACKOFF_CAP_MS = 2_000;

function isTransientServerStatus(status: number): boolean {
  return status === 500 || status === 502 || status === 503 || status === 504;
}

function transientBackoffMs(attempt: number): number {
  const base = Math.min(250 * 2 ** attempt, TRANSIENT_BACKOFF_CAP_MS);
  return base + Math.floor(Math.random() * 250);
}

async function postWithTransientRetry(
  request: APIRequestContext,
  path: string,
  options: { token: string; data?: unknown },
): Promise<APIResponse> {
  let response = await apiRequest(request, 'POST', path, options);
  for (let attempt = 0; attempt < TRANSIENT_CREATE_RETRIES && isTransientServerStatus(response.status()); attempt += 1) {
    await sleep(transientBackoffMs(attempt));
    response = await apiRequest(request, 'POST', path, options);
  }
  return response;
}

async function requestJsonWithTransientRetry<TBody>(
  request: APIRequestContext,
  method: string,
  path: string,
  token: string,
  data?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<ApiCallResult<TBody>> {
  let result = await requestJson<TBody>(request, method, path, token, data, extraHeaders);
  for (let attempt = 0; attempt < TRANSIENT_CREATE_RETRIES && isTransientServerStatus(result.status); attempt += 1) {
    await sleep(transientBackoffMs(attempt));
    result = await requestJson<TBody>(request, method, path, token, data, extraHeaders);
  }
  return result;
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

function applyRecordLockHeaders(
  requestHeaders: Record<string, string>,
  resourceKind: string,
  resourceId: string,
  lockHeaders?: RecordLockMutationHeaders,
): void {
  if (!lockHeaders) return;
  requestHeaders['x-om-record-lock-kind'] = resourceKind;
  requestHeaders['x-om-record-lock-resource-id'] = resourceId;
  if (lockHeaders.token) requestHeaders['x-om-record-lock-token'] = lockHeaders.token;
  if (lockHeaders.baseLogId) requestHeaders['x-om-record-lock-base-log-id'] = lockHeaders.baseLogId;
  if (lockHeaders.resolution) requestHeaders['x-om-record-lock-resolution'] = lockHeaders.resolution;
  if (lockHeaders.conflictId) requestHeaders['x-om-record-lock-conflict-id'] = lockHeaders.conflictId;
}

export async function updatePerson(
  request: APIRequestContext,
  token: string,
  personId: string,
  displayName: string,
  lockHeaders?: RecordLockMutationHeaders,
  extraHeaders?: Record<string, string>,
): Promise<ApiCallResult<Record<string, unknown>>> {
  const requestHeaders: Record<string, string> = { ...(extraHeaders ?? {}) };
  applyRecordLockHeaders(requestHeaders, 'customers.person', personId, lockHeaders);

  return requestJson<Record<string, unknown>>(
    request,
    'PUT',
    '/api/customers/people',
    token,
    { id: personId, displayName },
    requestHeaders,
  );
}

export async function updateDeal(
  request: APIRequestContext,
  token: string,
  dealId: string,
  title: string,
  lockHeaders?: RecordLockMutationHeaders,
  extraHeaders?: Record<string, string>,
): Promise<ApiCallResult<Record<string, unknown>>> {
  const requestHeaders: Record<string, string> = { ...(extraHeaders ?? {}) };
  applyRecordLockHeaders(requestHeaders, 'customers.deal', dealId, lockHeaders);

  return requestJson<Record<string, unknown>>(
    request,
    'PUT',
    '/api/customers/deals',
    token,
    { id: dealId, title },
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

async function readRowField(
  request: APIRequestContext,
  token: string,
  listPath: string,
  recordId: string,
  fields: readonly string[],
): Promise<string | null> {
  const response = await apiRequest(request, 'GET', listPath, { token });
  expect(response.ok(), `Failed to read ${listPath}: ${response.status()}`).toBeTruthy();
  const payload = (await readJsonSafe(response)) as { items?: Array<Record<string, unknown>> } | null;
  const rows = Array.isArray(payload?.items) ? payload.items : [];
  const row = rows.find((item) => typeof item.id === 'string' && item.id === recordId) ?? rows[0] ?? null;
  if (!row) return null;
  for (const field of fields) {
    const value = row[field];
    if (typeof value === 'string') return value;
  }
  return null;
}

export async function getPersonDisplayName(
  request: APIRequestContext,
  token: string,
  personId: string,
): Promise<string | null> {
  return readRowField(
    request,
    token,
    `/api/customers/people?id=${encodeURIComponent(personId)}&pageSize=5`,
    personId,
    ['display_name', 'displayName'],
  );
}

export async function getDealTitle(
  request: APIRequestContext,
  token: string,
  dealId: string,
): Promise<string | null> {
  return readRowField(
    request,
    token,
    `/api/customers/deals?id=${encodeURIComponent(dealId)}&pageSize=5`,
    dealId,
    ['title'],
  );
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

export async function executeNotificationAction(
  request: APIRequestContext,
  token: string,
  notificationId: string,
  actionId: string,
  payload?: Record<string, unknown>,
): Promise<ApiCallResult<{ ok?: boolean; result?: unknown; href?: string }>> {
  return requestJson<{ ok?: boolean; result?: unknown; href?: string }>(
    request,
    'POST',
    `/api/notifications/${encodeURIComponent(notificationId)}/action`,
    token,
    {
      actionId,
      ...(payload ? { payload } : {}),
    },
  );
}

export async function cleanupCompany(
  request: APIRequestContext,
  token: string | null,
  companyId: string | null,
): Promise<void> {
  await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
}

export async function cleanupPerson(
  request: APIRequestContext,
  token: string | null,
  personId: string | null,
): Promise<void> {
  await deleteEntityIfExists(request, token, '/api/customers/people', personId);
}

export async function cleanupDeal(
  request: APIRequestContext,
  token: string | null,
  dealId: string | null,
): Promise<void> {
  await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
}

// ─── Phase 2: customers subform / config-entity helpers ──────────────────────
//
// These exercise the OSS optimistic-lock floor wired by Phase 2 on the customer
// sub-entity write paths (interactions, todos, comments, tags, pipelines,
// pipeline-stages). The client sends the expected version via the OSS extension
// header; a stale value yields the structured 409 `optimistic_lock_conflict`
// the unified conflict bar keys off. With record_locks enabled + a held lock the
// enterprise resolver upgrades the same race to `record_lock_conflict`.

export const OPTIMISTIC_LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at';

function lockHeader(expectedUpdatedAt: string | null | undefined): Record<string, string> {
  return expectedUpdatedAt ? { [OPTIMISTIC_LOCK_HEADER]: expectedUpdatedAt } : {};
}

type ListRow = Record<string, unknown>;

function pickString(row: ListRow, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

async function findRowById(
  request: APIRequestContext,
  token: string,
  listPath: string,
  recordId: string,
): Promise<ListRow | null> {
  const response = await apiRequest(request, 'GET', listPath, { token });
  expect(response.ok(), `Failed GET ${listPath}: ${response.status()}`).toBeTruthy();
  const payload = (await readJsonSafe(response)) as { items?: ListRow[] } | null;
  const rows = Array.isArray(payload?.items) ? payload.items : [];
  return rows.find((item) => typeof item.id === 'string' && item.id === recordId) ?? null;
}

export async function createInteractionFixture(
  request: APIRequestContext,
  token: string,
  input: { entityId: string; title: string; interactionType?: string },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/customers/interactions', {
    token,
    data: { entityId: input.entityId, interactionType: input.interactionType ?? 'note', title: input.title, status: 'planned' },
  });
  expect(response.ok(), `Failed POST interaction: ${response.status()}`).toBeTruthy();
  const payload = (await readJsonSafe(response)) as Record<string, unknown> | null;
  const id = pickString((payload ?? {}) as ListRow, ['id', 'interactionId']);
  expect(id, 'No interaction id in response').toBeTruthy();
  return id as string;
}

export async function getInteractionUpdatedAt(
  request: APIRequestContext,
  token: string,
  entityId: string,
  interactionId: string,
): Promise<string | null> {
  const row = await findRowById(
    request,
    token,
    `/api/customers/interactions?entityId=${encodeURIComponent(entityId)}&pageSize=100`,
    interactionId,
  );
  return row ? pickString(row, ['updated_at', 'updatedAt']) : null;
}

export async function updateInteractionTitle(
  request: APIRequestContext,
  token: string,
  interactionId: string,
  title: string,
  expectedUpdatedAt?: string | null,
): Promise<ApiCallResult<Record<string, unknown>>> {
  return requestJson<Record<string, unknown>>(
    request,
    'PUT',
    '/api/customers/interactions',
    token,
    { id: interactionId, title },
    lockHeader(expectedUpdatedAt),
  );
}

export async function cleanupInteraction(
  request: APIRequestContext,
  token: string | null,
  interactionId: string | null,
): Promise<void> {
  await deleteEntityIfExists(request, token, '/api/customers/interactions', interactionId);
}

export async function createTodoFixture(
  request: APIRequestContext,
  token: string,
  input: { entityId: string; title: string },
): Promise<{ linkId: string; todoId: string }> {
  const response = await apiRequest(request, 'POST', '/api/customers/todos', {
    token,
    data: { entityId: input.entityId, title: input.title },
  });
  expect(response.ok(), `Failed POST todo: ${response.status()}`).toBeTruthy();
  const payload = (await readJsonSafe(response)) as Record<string, unknown> | null;
  const linkId = pickString((payload ?? {}) as ListRow, ['linkId']);
  const todoId = pickString((payload ?? {}) as ListRow, ['todoId']);
  expect(linkId, 'No todo linkId in response').toBeTruthy();
  expect(todoId, 'No todoId in response').toBeTruthy();
  return { linkId: linkId as string, todoId: todoId as string };
}

export async function getTodoUpdatedAt(
  request: APIRequestContext,
  token: string,
  entityId: string,
  linkId: string,
): Promise<string | null> {
  const row = await findRowById(
    request,
    token,
    `/api/customers/todos?entityId=${encodeURIComponent(entityId)}&pageSize=100`,
    linkId,
  );
  return row ? pickString(row, ['todoUpdatedAt', 'todo_updated_at']) : null;
}

export async function updateTodoTitle(
  request: APIRequestContext,
  token: string,
  input: { todoId: string; linkId: string; title: string },
  expectedUpdatedAt?: string | null,
): Promise<ApiCallResult<Record<string, unknown>>> {
  return requestJson<Record<string, unknown>>(
    request,
    'PUT',
    '/api/customers/todos',
    token,
    { id: input.todoId, linkId: input.linkId, title: input.title },
    lockHeader(expectedUpdatedAt),
  );
}

export async function cleanupTodoLink(
  request: APIRequestContext,
  token: string | null,
  linkId: string | null,
): Promise<void> {
  if (!token || !linkId) return;
  try {
    await apiRequest(request, 'DELETE', '/api/customers/todos', { token, data: { id: linkId } });
  } catch {
    return;
  }
}

export async function createCommentFixture(
  request: APIRequestContext,
  token: string,
  input: { entityId: string; body: string },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/customers/comments', {
    token,
    data: { entityId: input.entityId, body: input.body },
  });
  expect(response.ok(), `Failed POST comment: ${response.status()}`).toBeTruthy();
  const payload = (await readJsonSafe(response)) as Record<string, unknown> | null;
  const id = pickString((payload ?? {}) as ListRow, ['id', 'commentId']);
  expect(id, 'No comment id in response').toBeTruthy();
  return id as string;
}

export async function getCommentUpdatedAt(
  request: APIRequestContext,
  token: string,
  entityId: string,
  commentId: string,
): Promise<string | null> {
  const row = await findRowById(
    request,
    token,
    `/api/customers/comments?entityId=${encodeURIComponent(entityId)}&pageSize=100`,
    commentId,
  );
  return row ? pickString(row, ['updated_at', 'updatedAt']) : null;
}

export async function updateCommentBody(
  request: APIRequestContext,
  token: string,
  commentId: string,
  body: string,
  expectedUpdatedAt?: string | null,
): Promise<ApiCallResult<Record<string, unknown>>> {
  return requestJson<Record<string, unknown>>(
    request,
    'PUT',
    '/api/customers/comments',
    token,
    { id: commentId, body },
    lockHeader(expectedUpdatedAt),
  );
}

export async function cleanupComment(
  request: APIRequestContext,
  token: string | null,
  commentId: string | null,
): Promise<void> {
  await deleteEntityIfExists(request, token, '/api/customers/comments', commentId);
}

export async function createTagFixture(
  request: APIRequestContext,
  token: string,
  input: { slug: string; label: string },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/customers/tags', {
    token,
    data: { slug: input.slug, label: input.label },
  });
  expect(response.ok(), `Failed POST tag: ${response.status()}`).toBeTruthy();
  const payload = (await readJsonSafe(response)) as Record<string, unknown> | null;
  const id = pickString((payload ?? {}) as ListRow, ['id', 'tagId']);
  expect(id, 'No tag id in response').toBeTruthy();
  return id as string;
}

export async function getTagUpdatedAt(
  request: APIRequestContext,
  token: string,
  tagId: string,
): Promise<string | null> {
  const row = await findRowById(request, token, `/api/customers/tags?pageSize=100`, tagId);
  return row ? pickString(row, ['updated_at', 'updatedAt']) : null;
}

export async function updateTagLabel(
  request: APIRequestContext,
  token: string,
  tagId: string,
  label: string,
  expectedUpdatedAt?: string | null,
): Promise<ApiCallResult<Record<string, unknown>>> {
  return requestJson<Record<string, unknown>>(
    request,
    'PUT',
    '/api/customers/tags',
    token,
    { id: tagId, label },
    lockHeader(expectedUpdatedAt),
  );
}

export async function cleanupTag(
  request: APIRequestContext,
  token: string | null,
  tagId: string | null,
): Promise<void> {
  await deleteEntityIfExists(request, token, '/api/customers/tags', tagId);
}

export async function getPipelineUpdatedAt(
  request: APIRequestContext,
  token: string,
  pipelineId: string,
): Promise<string | null> {
  const row = await findRowById(request, token, `/api/customers/pipelines`, pipelineId);
  return row ? pickString(row, ['updatedAt', 'updated_at']) : null;
}

export async function updatePipelineName(
  request: APIRequestContext,
  token: string,
  pipelineId: string,
  name: string,
  expectedUpdatedAt?: string | null,
): Promise<ApiCallResult<Record<string, unknown>>> {
  return requestJson<Record<string, unknown>>(
    request,
    'PUT',
    '/api/customers/pipelines',
    token,
    { id: pipelineId, name },
    lockHeader(expectedUpdatedAt),
  );
}

export async function cleanupPipeline(
  request: APIRequestContext,
  token: string | null,
  pipelineId: string | null,
): Promise<void> {
  if (!token || !pipelineId) return;
  try {
    await apiRequest(request, 'DELETE', '/api/customers/pipelines', { token, data: { id: pipelineId } });
  } catch {
    return;
  }
}

export async function getPipelineStageUpdatedAt(
  request: APIRequestContext,
  token: string,
  pipelineId: string,
  stageId: string,
): Promise<string | null> {
  const row = await findRowById(
    request,
    token,
    `/api/customers/pipeline-stages?pipelineId=${encodeURIComponent(pipelineId)}`,
    stageId,
  );
  return row ? pickString(row, ['updatedAt', 'updated_at']) : null;
}

export async function updatePipelineStageLabel(
  request: APIRequestContext,
  token: string,
  stageId: string,
  label: string,
  expectedUpdatedAt?: string | null,
): Promise<ApiCallResult<Record<string, unknown>>> {
  return requestJson<Record<string, unknown>>(
    request,
    'PUT',
    '/api/customers/pipeline-stages',
    token,
    { id: stageId, label },
    lockHeader(expectedUpdatedAt),
  );
}

export async function cleanupPipelineStage(
  request: APIRequestContext,
  token: string | null,
  stageId: string | null,
): Promise<void> {
  if (!token || !stageId) return;
  try {
    await apiRequest(request, 'DELETE', '/api/customers/pipeline-stages', { token, data: { id: stageId } });
  } catch {
    return;
  }
}

// ─── Phase 3: sales document-aggregate + config helpers ──────────────────────
//
// Sales documents (orders/quotes) and their sub-resources (lines, adjustments,
// payments, shipments, returns) are guarded against the PARENT ORDER/QUOTE's
// aggregate `updated_at` — the consistency boundary. The client carries that
// expected version in the OSS optimistic-lock header; a stale value yields the
// structured 409 (`optimistic_lock_conflict`, or `record_lock_conflict` when
// record_locks is enabled + resolves a richer conflict). Config entities
// (channels/payment-methods/shipping-methods) are flat makeCrudRoute resources
// guarded on their OWN row, auto-covered by the CRUD mutation-guard decorator.

async function createSalesEntity(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
  idKeys: readonly string[],
): Promise<string> {
  const response = await postWithTransientRetry(request, path, { token, data });
  const body = await response.text();
  expect(response.ok(), `Failed POST ${path}: ${response.status()} body=${body}`).toBeTruthy();
  const payload = body ? (JSON.parse(body) as ListRow) : null;
  const id = pickString((payload ?? {}) as ListRow, idKeys);
  expect(id, `No id in POST ${path} response`).toBeTruthy();
  return id as string;
}

export async function createOrderFixture(
  request: APIRequestContext,
  token: string,
  currencyCode = 'USD',
): Promise<string> {
  return createSalesEntity(request, token, '/api/sales/orders', { currencyCode }, ['id', 'orderId']);
}

export async function createQuoteFixture(
  request: APIRequestContext,
  token: string,
  currencyCode = 'USD',
): Promise<string> {
  return createSalesEntity(request, token, '/api/sales/quotes', { currencyCode }, ['id', 'quoteId']);
}

export async function getOrderUpdatedAt(
  request: APIRequestContext,
  token: string,
  orderId: string,
): Promise<string | null> {
  const row = await findRowById(
    request,
    token,
    `/api/sales/orders?id=${encodeURIComponent(orderId)}&pageSize=5`,
    orderId,
  );
  return row ? pickString(row, ['updated_at', 'updatedAt']) : null;
}

export async function getQuoteUpdatedAt(
  request: APIRequestContext,
  token: string,
  quoteId: string,
): Promise<string | null> {
  const row = await findRowById(
    request,
    token,
    `/api/sales/quotes?id=${encodeURIComponent(quoteId)}&pageSize=5`,
    quoteId,
  );
  return row ? pickString(row, ['updated_at', 'updatedAt']) : null;
}

export async function updateOrderComment(
  request: APIRequestContext,
  token: string,
  orderId: string,
  comment: string,
  expectedUpdatedAt?: string | null,
): Promise<ApiCallResult<Record<string, unknown>>> {
  return requestJson<Record<string, unknown>>(
    request,
    'PUT',
    '/api/sales/orders',
    token,
    { id: orderId, comment },
    lockHeader(expectedUpdatedAt),
  );
}

export async function updateQuoteComment(
  request: APIRequestContext,
  token: string,
  quoteId: string,
  comment: string,
  expectedUpdatedAt?: string | null,
): Promise<ApiCallResult<Record<string, unknown>>> {
  return requestJson<Record<string, unknown>>(
    request,
    'PUT',
    '/api/sales/quotes',
    token,
    { id: quoteId, comment },
    lockHeader(expectedUpdatedAt),
  );
}

// Order sub-resource FIXTURES (lines/payments/shipments) guard the parent
// order's aggregate version. Under the full suite the background queue fleet
// (totals recalc / indexing on `sales.order.line.created` etc.) can advance the
// parent order's `updated_at` between the spec re-reading the version and
// issuing the next setup write, so a fixture create supplied with a freshly-read
// header still occasionally races to a legitimate 409. These are SETUP writes —
// they exist only to mutate the order into the desired pre-state, never to
// assert lock behaviour — so on a 409 we retry against the authoritative version.
// The structured conflict body carries `currentUpdatedAt`, which is the live
// server value (no list-cache staleness, unlike a re-read GET); we resync the
// header to it and retry. The lock-assertion mutations (`updateOrderComment`,
// `updatePaymentReference`, `updateShipmentCarrier`) intentionally do NOT use
// this recovery: they must observe the real first response (stale→409, fresh→2xx).
const SUBRESOURCE_CONFLICT_RETRIES = 6;

function conflictCurrentUpdatedAt(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  return pickString(body as ListRow, ['currentUpdatedAt', 'current_updated_at']);
}

async function createOrderSubResourceFixture(
  request: APIRequestContext,
  token: string,
  path: string,
  orderId: string,
  buildData: () => Record<string, unknown>,
  idKeys: readonly string[],
  label: string,
  expectedOrderUpdatedAt: string | null | undefined,
): Promise<string> {
  let expected = expectedOrderUpdatedAt;
  let result = await requestJsonWithTransientRetry<Record<string, unknown>>(
    request,
    'POST',
    path,
    token,
    buildData(),
    lockHeader(expected),
  );
  for (
    let attempt = 0;
    attempt < SUBRESOURCE_CONFLICT_RETRIES && result.status === 409 && (expected ?? null) !== null;
    attempt += 1
  ) {
    // Prefer the live version echoed in the conflict body; fall back to a
    // re-read for any handler that omits it.
    const nextExpected =
      conflictCurrentUpdatedAt(result.body) ?? (await getOrderUpdatedAt(request, token, orderId));
    await sleep(transientBackoffMs(attempt));
    if (nextExpected && nextExpected !== expected) {
      expected = nextExpected;
    }
    result = await requestJsonWithTransientRetry<Record<string, unknown>>(
      request,
      'POST',
      path,
      token,
      buildData(),
      lockHeader(expected),
    );
  }
  expect(result.status, `Failed POST ${label}: ${result.status} body=${JSON.stringify(result.body)}`).toBeLessThan(300);
  const id = pickString((result.body ?? {}) as ListRow, idKeys);
  expect(id, `No ${label} id in response`).toBeTruthy();
  return id as string;
}

export async function createPaymentFixture(
  request: APIRequestContext,
  token: string,
  orderId: string,
  expectedOrderUpdatedAt?: string | null,
): Promise<string> {
  return createOrderSubResourceFixture(
    request,
    token,
    '/api/sales/payments',
    orderId,
    () => ({ orderId, amount: '10.00', currencyCode: 'USD', receivedAt: new Date().toISOString() }),
    ['id', 'paymentId'],
    'payment',
    expectedOrderUpdatedAt,
  );
}

export async function updatePaymentReference(
  request: APIRequestContext,
  token: string,
  paymentId: string,
  reference: string,
  expectedOrderUpdatedAt?: string | null,
): Promise<ApiCallResult<Record<string, unknown>>> {
  return requestJson<Record<string, unknown>>(
    request,
    'PUT',
    '/api/sales/payments',
    token,
    { id: paymentId, paymentReference: reference },
    lockHeader(expectedOrderUpdatedAt),
  );
}

export async function createShipmentFixture(
  request: APIRequestContext,
  token: string,
  orderId: string,
  orderLineId: string,
  expectedOrderUpdatedAt?: string | null,
): Promise<string> {
  return createOrderSubResourceFixture(
    request,
    token,
    '/api/sales/shipments',
    orderId,
    () => ({
      orderId,
      currencyCode: 'USD',
      trackingNumbers: [`TRK-${Date.now()}`],
      shippedAt: new Date().toISOString(),
      items: [{ orderLineId, quantity: '1' }],
    }),
    ['id', 'shipmentId'],
    'shipment',
    expectedOrderUpdatedAt,
  );
}

export async function updateShipmentCarrier(
  request: APIRequestContext,
  token: string,
  shipmentId: string,
  orderId: string,
  carrierName: string,
  expectedOrderUpdatedAt?: string | null,
): Promise<ApiCallResult<Record<string, unknown>>> {
  return requestJson<Record<string, unknown>>(
    request,
    'PUT',
    '/api/sales/shipments',
    token,
    { id: shipmentId, orderId, carrierName },
    lockHeader(expectedOrderUpdatedAt),
  );
}

export async function createOrderLineFixtureForLock(
  request: APIRequestContext,
  token: string,
  orderId: string,
  expectedOrderUpdatedAt?: string | null,
): Promise<string> {
  return createOrderSubResourceFixture(
    request,
    token,
    '/api/sales/order-lines',
    orderId,
    () => ({
      orderId,
      currencyCode: 'USD',
      quantity: 1,
      name: `QA lock line ${Date.now()}`,
      unitPriceNet: 10,
      unitPriceGross: 12,
    }),
    ['id', 'lineId'],
    'order line',
    expectedOrderUpdatedAt,
  );
}

export async function cleanupOrder(
  request: APIRequestContext,
  token: string | null,
  orderId: string | null,
): Promise<void> {
  await deleteEntityIfExists(request, token, '/api/sales/orders', orderId);
}

export async function cleanupQuote(
  request: APIRequestContext,
  token: string | null,
  quoteId: string | null,
): Promise<void> {
  await deleteEntityIfExists(request, token, '/api/sales/quotes', quoteId);
}

export async function createSalesChannelFixture(
  request: APIRequestContext,
  token: string,
  input: { name: string; code: string },
): Promise<string> {
  return createSalesEntity(
    request,
    token,
    '/api/sales/channels',
    { name: input.name, code: input.code, isActive: true },
    ['id', 'channelId'],
  );
}

export async function getChannelUpdatedAt(
  request: APIRequestContext,
  token: string,
  channelId: string,
): Promise<string | null> {
  const row = await findRowById(request, token, `/api/sales/channels?pageSize=100`, channelId);
  return row ? pickString(row, ['updated_at', 'updatedAt']) : null;
}

export async function updateChannelName(
  request: APIRequestContext,
  token: string,
  channelId: string,
  code: string,
  name: string,
  expectedUpdatedAt?: string | null,
): Promise<ApiCallResult<Record<string, unknown>>> {
  return requestJson<Record<string, unknown>>(
    request,
    'PUT',
    '/api/sales/channels',
    token,
    { id: channelId, code, name },
    lockHeader(expectedUpdatedAt),
  );
}

export async function cleanupChannel(
  request: APIRequestContext,
  token: string | null,
  channelId: string | null,
): Promise<void> {
  await deleteEntityIfExists(request, token, '/api/sales/channels', channelId);
}

// ─── Phase 4: catalog product / variant / category / price-kind helpers ──────
//
// All four catalog entities are flat `makeCrudRoute` resources guarded on their
// OWN row by the CRUD mutation-guard decorator. The client carries the expected
// version in the OSS optimistic-lock header; a stale value yields the structured
// 409 (`optimistic_lock_conflict`, or `record_lock_conflict` when record_locks
// is enabled + resolves a richer conflict). Presence on the product/variant/
// category detail screens; price kinds are list/dialog editors (no presence).

export async function createProductFixture(
  request: APIRequestContext,
  token: string,
  title: string,
): Promise<string> {
  return createSalesEntity(request, token, '/api/catalog/products', { title }, ['id', 'productId']);
}

export async function getProductUpdatedAt(
  request: APIRequestContext,
  token: string,
  productId: string,
): Promise<string | null> {
  const row = await findRowById(
    request,
    token,
    `/api/catalog/products?id=${encodeURIComponent(productId)}&page=1&pageSize=5`,
    productId,
  );
  return row ? pickString(row, ['updated_at', 'updatedAt']) : null;
}

export async function updateProductTitle(
  request: APIRequestContext,
  token: string,
  productId: string,
  title: string,
  expectedUpdatedAt?: string | null,
): Promise<ApiCallResult<Record<string, unknown>>> {
  return requestJson<Record<string, unknown>>(
    request,
    'PUT',
    '/api/catalog/products',
    token,
    { id: productId, title },
    lockHeader(expectedUpdatedAt),
  );
}

export async function cleanupProduct(
  request: APIRequestContext,
  token: string | null,
  productId: string | null,
): Promise<void> {
  await deleteEntityIfExists(request, token, '/api/catalog/products', productId);
}

export async function createVariantFixture(
  request: APIRequestContext,
  token: string,
  productId: string,
  name: string,
): Promise<string> {
  return createSalesEntity(
    request,
    token,
    '/api/catalog/variants',
    { productId, name },
    ['id', 'variantId'],
  );
}

export async function getVariantUpdatedAt(
  request: APIRequestContext,
  token: string,
  variantId: string,
): Promise<string | null> {
  const row = await findRowById(
    request,
    token,
    `/api/catalog/variants?id=${encodeURIComponent(variantId)}&page=1&pageSize=5`,
    variantId,
  );
  return row ? pickString(row, ['updated_at', 'updatedAt']) : null;
}

export async function updateVariantName(
  request: APIRequestContext,
  token: string,
  variantId: string,
  productId: string,
  name: string,
  expectedUpdatedAt?: string | null,
): Promise<ApiCallResult<Record<string, unknown>>> {
  return requestJson<Record<string, unknown>>(
    request,
    'PUT',
    '/api/catalog/variants',
    token,
    { id: variantId, productId, name },
    lockHeader(expectedUpdatedAt),
  );
}

export async function cleanupVariant(
  request: APIRequestContext,
  token: string | null,
  variantId: string | null,
): Promise<void> {
  await deleteEntityIfExists(request, token, '/api/catalog/variants', variantId);
}

export async function createCategoryFixture(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<string> {
  return createSalesEntity(request, token, '/api/catalog/categories', { name }, ['id', 'categoryId']);
}

export async function getCategoryUpdatedAt(
  request: APIRequestContext,
  token: string,
  categoryId: string,
): Promise<string | null> {
  const row = await findRowById(
    request,
    token,
    `/api/catalog/categories?view=manage&ids=${encodeURIComponent(categoryId)}&status=all&page=1&pageSize=5`,
    categoryId,
  );
  return row ? pickString(row, ['updatedAt', 'updated_at']) : null;
}

export async function updateCategoryName(
  request: APIRequestContext,
  token: string,
  categoryId: string,
  name: string,
  expectedUpdatedAt?: string | null,
): Promise<ApiCallResult<Record<string, unknown>>> {
  return requestJson<Record<string, unknown>>(
    request,
    'PUT',
    '/api/catalog/categories',
    token,
    { id: categoryId, name },
    lockHeader(expectedUpdatedAt),
  );
}

export async function cleanupCategory(
  request: APIRequestContext,
  token: string | null,
  categoryId: string | null,
): Promise<void> {
  await deleteEntityIfExists(request, token, '/api/catalog/categories', categoryId);
}

export async function createPriceKindFixture(
  request: APIRequestContext,
  token: string,
  input: { code: string; title: string },
): Promise<string> {
  return createSalesEntity(
    request,
    token,
    '/api/catalog/price-kinds',
    { code: input.code, title: input.title, displayMode: 'excluding-tax', isActive: true },
    ['id', 'priceKindId'],
  );
}

export async function getPriceKindUpdatedAt(
  request: APIRequestContext,
  token: string,
  priceKindId: string,
): Promise<string | null> {
  const row = await findRowById(request, token, `/api/catalog/price-kinds?pageSize=100`, priceKindId);
  return row ? pickString(row, ['updatedAt', 'updated_at']) : null;
}

export async function updatePriceKindTitle(
  request: APIRequestContext,
  token: string,
  priceKindId: string,
  title: string,
  expectedUpdatedAt?: string | null,
): Promise<ApiCallResult<Record<string, unknown>>> {
  return requestJson<Record<string, unknown>>(
    request,
    'PUT',
    '/api/catalog/price-kinds',
    token,
    { id: priceKindId, title },
    lockHeader(expectedUpdatedAt),
  );
}

export async function cleanupPriceKind(
  request: APIRequestContext,
  token: string | null,
  priceKindId: string | null,
): Promise<void> {
  await deleteEntityIfExists(request, token, '/api/catalog/price-kinds', priceKindId);
}

// ─── Phase 5: auth / directory / staff / resources helpers ───────────────────
//
// All four entities below are flat `makeCrudRoute` resources guarded on their
// OWN row by the CRUD mutation-guard decorator. The client carries the expected
// version in the OSS optimistic-lock header; a stale value yields the structured
// 409 (`optimistic_lock_conflict`, or `record_lock_conflict` when record_locks
// is enabled + resolves a richer conflict). Presence is mounted on each module's
// edit/detail screen so the merge dialog surfaces the concurrent-edit 409.

export async function createRoleFixture(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<string> {
  return createSalesEntity(request, token, '/api/auth/roles', { name }, ['id', 'roleId']);
}

export async function getRoleUpdatedAt(
  request: APIRequestContext,
  token: string,
  roleId: string,
): Promise<string | null> {
  const row = await findRowById(request, token, `/api/auth/roles?id=${encodeURIComponent(roleId)}`, roleId);
  return row ? pickString(row, ['updatedAt', 'updated_at']) : null;
}

export async function updateRoleName(
  request: APIRequestContext,
  token: string,
  roleId: string,
  name: string,
  expectedUpdatedAt?: string | null,
): Promise<ApiCallResult<Record<string, unknown>>> {
  return requestJson<Record<string, unknown>>(
    request,
    'PUT',
    '/api/auth/roles',
    token,
    { id: roleId, name },
    lockHeader(expectedUpdatedAt),
  );
}

export async function cleanupRole(
  request: APIRequestContext,
  token: string | null,
  roleId: string | null,
): Promise<void> {
  await deleteEntityIfExists(request, token, '/api/auth/roles', roleId);
}

export async function createOrganizationFixture(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<string> {
  const { tenantId } = getTokenContext(token);
  return createSalesEntity(request, token, '/api/directory/organizations', { name, tenantId }, ['id', 'organizationId']);
}

export async function getOrganizationUpdatedAt(
  request: APIRequestContext,
  token: string,
  organizationId: string,
): Promise<string | null> {
  const row = await findRowById(
    request,
    token,
    `/api/directory/organizations?view=manage&ids=${encodeURIComponent(organizationId)}&status=all&includeInactive=true&page=1&pageSize=5`,
    organizationId,
  );
  return row ? pickString(row, ['updatedAt', 'updated_at']) : null;
}

export async function updateOrganizationName(
  request: APIRequestContext,
  token: string,
  organizationId: string,
  name: string,
  expectedUpdatedAt?: string | null,
): Promise<ApiCallResult<Record<string, unknown>>> {
  return requestJson<Record<string, unknown>>(
    request,
    'PUT',
    '/api/directory/organizations',
    token,
    { id: organizationId, name },
    lockHeader(expectedUpdatedAt),
  );
}

export async function cleanupOrganization(
  request: APIRequestContext,
  token: string | null,
  organizationId: string | null,
): Promise<void> {
  await deleteEntityIfExists(request, token, '/api/directory/organizations', organizationId);
}

export async function createStaffTeamFixture(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<string> {
  return createSalesEntity(request, token, '/api/staff/teams', { name }, ['id', 'teamId']);
}

export async function getStaffTeamUpdatedAt(
  request: APIRequestContext,
  token: string,
  teamId: string,
): Promise<string | null> {
  const row = await findRowById(
    request,
    token,
    `/api/staff/teams?ids=${encodeURIComponent(teamId)}&page=1&pageSize=5`,
    teamId,
  );
  return row ? pickString(row, ['updatedAt', 'updated_at']) : null;
}

export async function updateStaffTeamName(
  request: APIRequestContext,
  token: string,
  teamId: string,
  name: string,
  expectedUpdatedAt?: string | null,
): Promise<ApiCallResult<Record<string, unknown>>> {
  return requestJson<Record<string, unknown>>(
    request,
    'PUT',
    '/api/staff/teams',
    token,
    { id: teamId, name },
    lockHeader(expectedUpdatedAt),
  );
}

export async function cleanupStaffTeam(
  request: APIRequestContext,
  token: string | null,
  teamId: string | null,
): Promise<void> {
  await deleteEntityIfExists(request, token, '/api/staff/teams', teamId);
}

export async function createResourceFixture(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<string> {
  return createSalesEntity(request, token, '/api/resources/resources', { name }, ['id', 'resourceId']);
}

export async function getResourceUpdatedAt(
  request: APIRequestContext,
  token: string,
  resourceId: string,
): Promise<string | null> {
  const row = await findRowById(
    request,
    token,
    `/api/resources/resources?ids=${encodeURIComponent(resourceId)}&page=1&pageSize=5`,
    resourceId,
  );
  return row ? pickString(row, ['updatedAt', 'updated_at']) : null;
}

export async function updateResourceName(
  request: APIRequestContext,
  token: string,
  resourceId: string,
  name: string,
  expectedUpdatedAt?: string | null,
): Promise<ApiCallResult<Record<string, unknown>>> {
  return requestJson<Record<string, unknown>>(
    request,
    'PUT',
    '/api/resources/resources',
    token,
    { id: resourceId, name },
    lockHeader(expectedUpdatedAt),
  );
}

export async function cleanupResource(
  request: APIRequestContext,
  token: string | null,
  resourceId: string | null,
): Promise<void> {
  await deleteEntityIfExists(request, token, '/api/resources/resources', resourceId);
}

// ─── Phase 6: platform-config helpers (dictionaries / currencies / workflows) ─
//
// These exercise the OSS optimistic-lock floor on platform-config write paths
// covered by Phase 6's presence mounts + conflict wiring. The client carries the
// expected version in the OSS optimistic-lock header; a stale value yields the
// structured 409 (`optimistic_lock_conflict`, or `record_lock_conflict` when
// record_locks is enabled + resolves a richer conflict).
//
// Dictionary entries and workflow definitions are hand-rolled command routes
// (NOT `makeCrudRoute`); their PUT/PATCH call `enforceCommandOptimisticLock`. The
// currency detail/list screens are `makeCrudRoute` resources guarded on their OWN
// row by the CRUD mutation-guard decorator.

export async function createDictionaryFixture(
  request: APIRequestContext,
  token: string,
  input: { key: string; name: string },
): Promise<string> {
  const result = await requestJson<{ id?: string }>(
    request,
    'POST',
    '/api/dictionaries',
    token,
    { key: input.key, name: input.name },
  );
  expect(result.status, `Failed POST dictionary: ${result.status}`).toBeLessThan(300);
  expect(result.body?.id, 'No dictionary id in response').toBeTruthy();
  return result.body?.id as string;
}

export async function createDictionaryEntryFixture(
  request: APIRequestContext,
  token: string,
  dictionaryId: string,
  input: { value: string; label: string },
): Promise<{ entryId: string; updatedAt: string | null }> {
  const result = await requestJson<{ id?: string; updatedAt?: string }>(
    request,
    'POST',
    `/api/dictionaries/${dictionaryId}/entries`,
    token,
    { value: input.value, label: input.label },
  );
  expect(result.status, `Failed POST dictionary entry: ${result.status}`).toBeLessThan(300);
  expect(result.body?.id, 'No dictionary entry id in response').toBeTruthy();
  return {
    entryId: result.body?.id as string,
    updatedAt: typeof result.body?.updatedAt === 'string' ? result.body.updatedAt : null,
  };
}

export async function getDictionaryEntryUpdatedAt(
  request: APIRequestContext,
  token: string,
  dictionaryId: string,
  entryId: string,
): Promise<string | null> {
  const row = await findRowById(
    request,
    token,
    `/api/dictionaries/${dictionaryId}/entries`,
    entryId,
  );
  return row ? pickString(row, ['updatedAt', 'updated_at']) : null;
}

export async function updateDictionaryEntryLabel(
  request: APIRequestContext,
  token: string,
  dictionaryId: string,
  entryId: string,
  label: string,
  expectedUpdatedAt?: string | null,
): Promise<ApiCallResult<Record<string, unknown>>> {
  return requestJson<Record<string, unknown>>(
    request,
    'PATCH',
    `/api/dictionaries/${dictionaryId}/entries/${entryId}`,
    token,
    { label },
    lockHeader(expectedUpdatedAt),
  );
}

export async function cleanupDictionary(
  request: APIRequestContext,
  token: string | null,
  dictionaryId: string | null,
): Promise<void> {
  if (!token || !dictionaryId) return;
  try {
    await requestJson(request, 'DELETE', `/api/dictionaries/${dictionaryId}`, token);
  } catch {
    return;
  }
}

export async function createCurrencyFixture(
  request: APIRequestContext,
  token: string,
  input: { code: string; name: string },
): Promise<string> {
  const { organizationId, tenantId } = getTokenContext(token);
  return createSalesEntity(
    request,
    token,
    '/api/currencies/currencies',
    { organizationId, tenantId, code: input.code, name: input.name, decimalPlaces: 2, isActive: true },
    ['id', 'currencyId'],
  );
}

export async function getCurrencyUpdatedAt(
  request: APIRequestContext,
  token: string,
  currencyId: string,
): Promise<string | null> {
  const row = await findRowById(
    request,
    token,
    `/api/currencies/currencies?id=${encodeURIComponent(currencyId)}&pageSize=5`,
    currencyId,
  );
  return row ? pickString(row, ['updatedAt', 'updated_at']) : null;
}

export async function updateCurrencyName(
  request: APIRequestContext,
  token: string,
  currencyId: string,
  name: string,
  expectedUpdatedAt?: string | null,
): Promise<ApiCallResult<Record<string, unknown>>> {
  return requestJson<Record<string, unknown>>(
    request,
    'PUT',
    '/api/currencies/currencies',
    token,
    { id: currencyId, name },
    lockHeader(expectedUpdatedAt),
  );
}

export async function cleanupCurrency(
  request: APIRequestContext,
  token: string | null,
  currencyId: string | null,
): Promise<void> {
  await deleteEntityIfExists(request, token, '/api/currencies/currencies', currencyId);
}

export async function getWorkflowDefinitionUpdatedAt(
  request: APIRequestContext,
  token: string,
  definitionId: string,
): Promise<string | null> {
  const result = await requestJson<{ data?: { updatedAt?: string } }>(
    request,
    'GET',
    `/api/workflows/definitions/${definitionId}`,
    token,
  );
  expect(result.status, `Failed GET workflow definition: ${result.status}`).toBe(200);
  return typeof result.body?.data?.updatedAt === 'string' ? result.body.data.updatedAt : null;
}

/**
 * Mirror the visual editor save: a PUT to `/api/workflows/definitions/<id>` that
 * carries the OSS optimistic-lock header built from the editor's captured
 * `updatedAt`. The visual editor sends `workflowName` (and more) in the body; a
 * single `workflowName` change is enough to exercise the lock path.
 */
export async function updateWorkflowDefinitionName(
  request: APIRequestContext,
  token: string,
  definitionId: string,
  workflowName: string,
  expectedUpdatedAt?: string | null,
): Promise<ApiCallResult<Record<string, unknown>>> {
  return requestJson<Record<string, unknown>>(
    request,
    'PUT',
    `/api/workflows/definitions/${definitionId}`,
    token,
    { workflowName },
    lockHeader(expectedUpdatedAt),
  );
}

export async function getBusinessRuleUpdatedAt(
  request: APIRequestContext,
  token: string,
  ruleId: string,
): Promise<string | null> {
  const row = await findRowById(request, token, `/api/business_rules/rules?pageSize=100`, ruleId);
  return row ? pickString(row, ['updatedAt', 'updated_at']) : null;
}

export async function updateBusinessRuleName(
  request: APIRequestContext,
  token: string,
  ruleId: string,
  ruleName: string,
  expectedUpdatedAt?: string | null,
): Promise<ApiCallResult<Record<string, unknown>>> {
  return requestJson<Record<string, unknown>>(
    request,
    'PUT',
    '/api/business_rules/rules',
    token,
    { id: ruleId, ruleName },
    lockHeader(expectedUpdatedAt),
  );
}

// ─── Phase 6b: command-seam coverage helpers ─────────────────────────────────
//
// EAV custom-entity records (`entities.record`), feature-toggle overrides
// (`feature_toggles.feature_toggle_override`) and role ACLs (`auth.role_acl`)
// are command-pattern / hand-rolled writes guarded via the async DI-aware seam
// `enforceCommandOptimisticLockWithGuards`. The client carries the expected
// version in the OSS optimistic-lock header; a stale value 409s and record_locks
// (when enabled) resolves the richer `record_lock_conflict`.

export async function createCustomEntityDefinitionFixture(
  request: APIRequestContext,
  token: string,
  input: { entityId: string; label: string },
): Promise<void> {
  const response = await apiRequest(request, 'POST', '/api/entities/entities', {
    token,
    data: { entityId: input.entityId, label: input.label, isActive: true },
  });
  expect(response.ok(), `Failed POST custom entity definition: ${response.status()}`).toBeTruthy();

  // Declare the `name` custom field so record create/update can carry a value.
  const fieldResponse = await apiRequest(request, 'POST', '/api/entities/definitions', {
    token,
    data: { entityId: input.entityId, key: 'name', kind: 'text', isActive: true },
  });
  expect(
    fieldResponse.ok(),
    `Failed POST custom entity field definition: ${fieldResponse.status()}`,
  ).toBeTruthy();
}

export async function createCustomEntityRecordFixture(
  request: APIRequestContext,
  token: string,
  input: { entityId: string; values: Record<string, unknown> },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/entities/records', {
    token,
    data: { entityId: input.entityId, values: input.values },
  });
  expect(response.ok(), `Failed POST custom entity record: ${response.status()}`).toBeTruthy();
  const payload = (await readJsonSafe(response)) as { item?: { recordId?: string } } | null;
  const recordId = payload?.item?.recordId;
  expect(recordId, 'No recordId in record POST response').toBeTruthy();
  return recordId as string;
}

export async function getCustomEntityRecordUpdatedAt(
  request: APIRequestContext,
  token: string,
  entityId: string,
  recordId: string,
): Promise<string | null> {
  const row = await findRowById(
    request,
    token,
    `/api/entities/records?entityId=${encodeURIComponent(entityId)}&pageSize=100`,
    recordId,
  );
  return row ? pickString(row, ['updated_at', 'updatedAt']) : null;
}

export async function updateCustomEntityRecord(
  request: APIRequestContext,
  token: string,
  input: { entityId: string; recordId: string; values: Record<string, unknown> },
  expectedUpdatedAt?: string | null,
): Promise<ApiCallResult<Record<string, unknown>>> {
  return requestJson<Record<string, unknown>>(
    request,
    'PUT',
    '/api/entities/records',
    token,
    { entityId: input.entityId, recordId: input.recordId, values: input.values },
    lockHeader(expectedUpdatedAt),
  );
}

export async function cleanupCustomEntityRecord(
  request: APIRequestContext,
  token: string | null,
  entityId: string | null,
  recordId: string | null,
): Promise<void> {
  if (!token || !entityId || !recordId) return;
  try {
    await apiRequest(request, 'DELETE', '/api/entities/records', { token, data: { entityId, recordId } });
  } catch {
    return;
  }
}

export async function cleanupCustomEntityDefinition(
  request: APIRequestContext,
  token: string | null,
  entityId: string | null,
): Promise<void> {
  if (!token || !entityId) return;
  try {
    await apiRequest(request, 'DELETE', '/api/entities/entities', { token, data: { entityId } });
  } catch {
    return;
  }
}

export type FeatureToggleOverrideRow = {
  toggleId: string;
  updatedAt: string | null;
  identifier?: string | null;
};

export async function findFeatureToggleOverrideTarget(
  request: APIRequestContext,
  token: string,
): Promise<FeatureToggleOverrideRow | null> {
  const response = await apiRequest(request, 'GET', '/api/feature_toggles/overrides?pageSize=100', { token });
  expect(response.ok(), `Failed GET feature toggle overrides: ${response.status()}`).toBeTruthy();
  const payload = (await readJsonSafe(response)) as { items?: ListRow[] } | null;
  const rows = Array.isArray(payload?.items) ? payload.items : [];
  for (const row of rows) {
    const toggleId = pickString(row, ['toggleId', 'id']);
    if (toggleId) {
      return {
        toggleId,
        updatedAt: pickString(row, ['overrideUpdatedAt', 'updatedAt', 'updated_at']),
        identifier: pickString(row, ['identifier']),
      };
    }
  }
  return null;
}

export async function getFeatureToggleOverrideUpdatedAt(
  request: APIRequestContext,
  token: string,
  toggleId: string,
): Promise<string | null> {
  const response = await apiRequest(request, 'GET', '/api/feature_toggles/overrides?pageSize=100', { token });
  expect(response.ok(), `Failed GET feature toggle overrides: ${response.status()}`).toBeTruthy();
  const payload = (await readJsonSafe(response)) as { items?: ListRow[] } | null;
  const rows = Array.isArray(payload?.items) ? payload.items : [];
  const row = rows.find((item) => pickString(item, ['toggleId', 'id']) === toggleId);
  return row ? pickString(row, ['overrideUpdatedAt', 'updatedAt', 'updated_at']) : null;
}

export async function setFeatureToggleOverride(
  request: APIRequestContext,
  token: string,
  input: { toggleId: string; isOverride: boolean; overrideValue: unknown },
  expectedUpdatedAt?: string | null,
): Promise<ApiCallResult<Record<string, unknown>>> {
  return requestJson<Record<string, unknown>>(
    request,
    'PUT',
    '/api/feature_toggles/overrides',
    token,
    { toggleId: input.toggleId, isOverride: input.isOverride, overrideValue: input.overrideValue },
    lockHeader(expectedUpdatedAt),
  );
}

export async function getRoleAclUpdatedAt(
  request: APIRequestContext,
  token: string,
  roleId: string,
): Promise<string | null> {
  const result = await requestJson<{ updatedAt?: string | null }>(
    request,
    'GET',
    `/api/auth/roles/acl?roleId=${encodeURIComponent(roleId)}`,
    token,
  );
  expect(result.status, `Failed GET role ACL: ${result.status}`).toBe(200);
  return result.body?.updatedAt ?? null;
}

export async function updateRoleAcl(
  request: APIRequestContext,
  token: string,
  input: { roleId: string; features: string[] },
  expectedUpdatedAt?: string | null,
): Promise<ApiCallResult<Record<string, unknown>>> {
  return requestJson<Record<string, unknown>>(
    request,
    'PUT',
    '/api/auth/roles/acl',
    token,
    { roleId: input.roleId, features: input.features },
    lockHeader(expectedUpdatedAt),
  );
}

// ─── Phase 6b part B: package command-seam coverage (webhooks / checkout) ─────
//
// `webhooks.endpoint` (PUT/DELETE `/api/webhooks/[id]`) and `checkout.link` /
// `checkout.template` (PUT/DELETE `/api/checkout/{links,templates}/[id]`) are
// command-pattern / hand-rolled writes migrated to the async DI-aware seam
// `enforceCommandOptimisticLockWithGuards`. The client carries the expected
// version in the OSS optimistic-lock header; a stale value 409s and record_locks
// (when enabled) resolves the richer `record_lock_conflict`.

export async function createWebhookFixture(
  request: APIRequestContext,
  token: string,
  input: { name: string; url: string; events?: string[] },
): Promise<string> {
  const result = await requestJson<Record<string, unknown>>(request, 'POST', '/api/webhooks', token, {
    name: input.name,
    url: input.url,
    subscribedEvents: input.events ?? ['sales.order.created'],
    httpMethod: 'POST',
  });
  expect(result.status, `Failed POST webhook: ${result.status}`).toBeLessThan(300);
  const id = result.body?.id;
  expect(typeof id, 'webhook create should return id').toBe('string');
  return id as string;
}

export async function getWebhookUpdatedAt(
  request: APIRequestContext,
  token: string,
  webhookId: string,
): Promise<string | null> {
  const result = await requestJson<Record<string, unknown>>(request, 'GET', `/api/webhooks/${webhookId}`, token);
  expect(result.status, `Failed GET webhook: ${result.status}`).toBe(200);
  return pickString(result.body ?? {}, ['updatedAt', 'updated_at']);
}

export async function updateWebhookName(
  request: APIRequestContext,
  token: string,
  webhookId: string,
  name: string,
  expectedUpdatedAt?: string | null,
): Promise<ApiCallResult<Record<string, unknown>>> {
  return requestJson<Record<string, unknown>>(
    request,
    'PUT',
    `/api/webhooks/${webhookId}`,
    token,
    { name },
    lockHeader(expectedUpdatedAt),
  );
}

export async function deleteWebhookIfExists(
  request: APIRequestContext,
  token: string,
  webhookId: string | null,
  expectedUpdatedAt?: string | null,
): Promise<void> {
  if (!webhookId) return;
  await requestJson(request, 'DELETE', `/api/webhooks/${webhookId}`, token, undefined, lockHeader(expectedUpdatedAt)).catch(() => undefined);
}

type CheckoutKind = 'links' | 'templates';

function checkoutFixedInput(name: string): Record<string, unknown> {
  return {
    name,
    pricingMode: 'fixed',
    fixedPriceAmount: 49.99,
    fixedPriceCurrencyCode: 'USD',
    gatewayProviderKey: 'mock',
    status: 'draft',
  };
}

export async function createCheckoutLinkFixture(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<string> {
  const result = await requestJson<{ id?: string }>(request, 'POST', '/api/checkout/links', token, checkoutFixedInput(name));
  expect(result.status, `Failed POST checkout link: ${result.status}`).toBeLessThan(300);
  expect(typeof result.body?.id, 'checkout link create should return id').toBe('string');
  return result.body!.id as string;
}

export async function createCheckoutTemplateFixture(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<string> {
  const result = await requestJson<{ id?: string }>(request, 'POST', '/api/checkout/templates', token, checkoutFixedInput(name));
  expect(result.status, `Failed POST checkout template: ${result.status}`).toBeLessThan(300);
  expect(typeof result.body?.id, 'checkout template create should return id').toBe('string');
  return result.body!.id as string;
}

export async function getCheckoutUpdatedAt(
  request: APIRequestContext,
  token: string,
  kind: CheckoutKind,
  recordId: string,
): Promise<string | null> {
  const result = await requestJson<Record<string, unknown>>(request, 'GET', `/api/checkout/${kind}/${recordId}`, token);
  expect(result.status, `Failed GET checkout ${kind}: ${result.status}`).toBe(200);
  return pickString(result.body ?? {}, ['updatedAt', 'updated_at']);
}

export async function updateCheckoutSubtitle(
  request: APIRequestContext,
  token: string,
  kind: CheckoutKind,
  recordId: string,
  subtitle: string,
  expectedUpdatedAt?: string | null,
): Promise<ApiCallResult<Record<string, unknown>>> {
  return requestJson<Record<string, unknown>>(
    request,
    'PUT',
    `/api/checkout/${kind}/${recordId}`,
    token,
    { subtitle },
    lockHeader(expectedUpdatedAt),
  );
}

export async function deleteCheckoutIfExists(
  request: APIRequestContext,
  token: string,
  kind: CheckoutKind,
  recordId: string | null,
  expectedUpdatedAt?: string | null,
): Promise<void> {
  if (!recordId) return;
  await requestJson(request, 'DELETE', `/api/checkout/${kind}/${recordId}`, token, undefined, lockHeader(expectedUpdatedAt)).catch(() => undefined);
}
