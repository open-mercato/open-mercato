import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { apiRequest } from '@open-mercato/core/helpers/integration/api';

/**
 * Module-local helpers for the entities API integration specs (issue #2471).
 *
 * Shared cross-module helpers (auth tokens, user/org/role fixtures) are imported
 * by the specs directly from `@open-mercato/core/helpers/integration/*`. This file
 * only adds the entities-specific request builders, an unauthenticated request
 * (for 401 coverage) and a regex-valid unique entity id generator.
 *
 * Verified route map (generated registry → `/api/<file-path-with-dots>`):
 *   - POST/GET/DELETE /api/entities/entities            (custom entity definitions)
 *   - POST            /api/entities/definitions.batch   (field definitions, batch)
 *   - GET             /api/entities/definitions.manage   (scoped field definitions)
 *   - POST/GET/DELETE /api/entities/records              (custom entity records)
 * The bare `/api/entities` and slash variants (`/definitions/batch`) return 404.
 */

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000';

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type FieldDefinitionInput = {
  key: string;
  kind: string;
  configJson?: Record<string, unknown>;
  isActive?: boolean;
};

/**
 * Generates a unique entity id matching the platform regex `^[a-z0-9_]+:[a-z0-9_]+$`.
 * Uniqueness (timestamp + random) keeps specs idempotent across retries and parallel
 * workers without colliding with soft-deleted leftovers from previous runs.
 */
export function uniqueEntityId(entityPart = 'item'): string {
  const stamp = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 46_656).toString(36);
  return `e2e_ent_${stamp}_${rand}:${entityPart}`;
}

/** Asserts the value is a UUID string and returns it. */
export function expectUuid(value: unknown, label: string): string {
  expect(typeof value === 'string' && UUID_REGEX.test(value as string), `${label} should be a UUID`).toBe(true);
  return value as string;
}

/** Authenticated entity-definition upsert: POST /api/entities/entities. */
export function createCustomEntity(
  request: APIRequestContext,
  token: string,
  body: { entityId: string; label: string; description?: string },
): Promise<APIResponse> {
  return apiRequest(request, 'POST', '/api/entities/entities', { token, data: body });
}

/** Authenticated entity list: GET /api/entities/entities. */
export function listCustomEntities(request: APIRequestContext, token: string): Promise<APIResponse> {
  return apiRequest(request, 'GET', '/api/entities/entities', { token });
}

/** Best-effort soft-delete cleanup for a custom entity definition. */
export async function deleteCustomEntityIfExists(
  request: APIRequestContext,
  token: string | null,
  entityId: string | null,
): Promise<void> {
  if (!token || !entityId) return;
  await apiRequest(request, 'DELETE', '/api/entities/entities', { token, data: { entityId } }).catch(() => undefined);
}

/** Batch field-definition upsert: POST /api/entities/definitions.batch. */
export function saveFieldDefinitions(
  request: APIRequestContext,
  token: string,
  entityId: string,
  definitions: FieldDefinitionInput[],
): Promise<APIResponse> {
  return apiRequest(request, 'POST', '/api/entities/definitions.batch', { token, data: { entityId, definitions } });
}

/** Scoped field-definition snapshot: GET /api/entities/definitions.manage. */
export function listFieldDefinitions(
  request: APIRequestContext,
  token: string,
  entityId: string,
): Promise<APIResponse> {
  return apiRequest(request, 'GET', `/api/entities/definitions.manage?entityId=${encodeURIComponent(entityId)}`, {
    token,
  });
}

/** Record create: POST /api/entities/records. */
export function createRecord(
  request: APIRequestContext,
  token: string,
  entityId: string,
  values: Record<string, unknown>,
): Promise<APIResponse> {
  return apiRequest(request, 'POST', '/api/entities/records', { token, data: { entityId, values } });
}

/** Record list: GET /api/entities/records. */
export function listRecords(
  request: APIRequestContext,
  token: string,
  entityId: string,
  extraQuery = '',
): Promise<APIResponse> {
  const base = `/api/entities/records?entityId=${encodeURIComponent(entityId)}&page=1&pageSize=50&sortField=id&sortDir=asc`;
  return apiRequest(request, 'GET', `${base}${extraQuery}`, { token });
}

/** Best-effort soft-delete cleanup for a single record. */
export async function deleteRecordIfExists(
  request: APIRequestContext,
  token: string | null,
  entityId: string | null,
  recordId: string | null,
): Promise<void> {
  if (!token || !entityId || !recordId) return;
  await apiRequest(
    request,
    'DELETE',
    `/api/entities/records?entityId=${encodeURIComponent(entityId)}&recordId=${encodeURIComponent(recordId)}`,
    { token },
  ).catch(() => undefined);
}

/**
 * Unauthenticated request (no Authorization header) for 401 coverage.
 * Mirrors {@link apiRequest} but omits the bearer token.
 */
export function rawRequest(
  request: APIRequestContext,
  method: string,
  path: string,
  data?: unknown,
): Promise<APIResponse> {
  return request.fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    data: data === undefined ? undefined : JSON.stringify(data),
  });
}
