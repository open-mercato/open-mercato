import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { apiRequest } from './api';
import { expectId, readJsonSafe } from './generalFixtures';
import {
  CRUDFORM_EXTENSION_TESTS_DISABLED_ENV,
  crudFormExtensionTestsDisabled,
  getCustomFieldValue,
  type CrudRecord,
} from './crudFormFields';

/**
 * Playwright harness for the CrudForm field-persistence sweep (umbrella #2466).
 *
 * Every spec proves a CrudForm surface saves AND reloads every field type — scalars,
 * dictionary references, multiselect/array values, and **custom fields** — on both create
 * and update.
 *
 * The whole sweep is gated by `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED`
 * (default `false` → tests run). When set truthy the specs `test.skip()` themselves, so the
 * sweep can be disabled wholesale without deleting any spec.
 */

export {
  CRUDFORM_EXTENSION_TESTS_DISABLED_ENV,
  crudFormExtensionTestsDisabled,
  getCustomFieldValue,
  type CrudRecord,
};

/**
 * Call inside `test.beforeAll` (or a test body) to skip the spec when the sweep is disabled.
 * Uses Playwright's `test.skip(condition, reason)` so the spec is reported as skipped, not failed.
 */
export function skipIfCrudFormExtensionTestsDisabled(): void {
  test.skip(
    crudFormExtensionTestsDisabled(),
    `${CRUDFORM_EXTENSION_TESTS_DISABLED_ENV} is set — CrudForm field-persistence sweep skipped`,
  );
}

/** Asserts each expected scalar field round-tripped (deep equality so arrays/objects work). */
export function assertScalarFieldsPersisted(record: CrudRecord, expected: CrudRecord, label = 'record'): void {
  for (const [key, value] of Object.entries(expected)) {
    expect(record[key], `${label}.${key} should persist`).toEqual(value);
  }
}

/** Asserts each expected custom field round-tripped, regardless of response shape. */
export function assertCustomFieldsPersisted(record: CrudRecord, expected: CrudRecord, label = 'record'): void {
  for (const [name, value] of Object.entries(expected)) {
    expect(getCustomFieldValue(record, name), `${label} custom field "${name}" should persist`).toEqual(value);
  }
}

async function safeText(response: APIResponse): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '<unreadable body>';
  }
}

export type CrudFormExpectation = {
  scalars?: CrudRecord;
  customFields?: CrudRecord;
};

export type CrudFormRoundTripConfig = {
  request: APIRequestContext;
  token: string;
  /** Collection route handling POST (and, without `recordPath`, the collection-style PUT/DELETE and `?id=` list GET), e.g. `/api/currencies/currencies`. */
  collectionPath: string;
  create: { payload: CrudRecord; expectedStatus?: number };
  /** Build the PUT body from the created id. For makeCrud collection routes include the id the route expects; for `recordPath` (detail) routes the id is taken from the path. */
  update: { payload: (id: string) => CrudRecord; expectedStatus?: number };
  expectAfterCreate: CrudFormExpectation;
  expectAfterUpdate: CrudFormExpectation;
  /** Override id extraction from the create response (default: `id` ?? `entityId`). */
  idFromCreate?: (body: CrudRecord) => string;
  /** Override read-back (default: list `?id=` and match on `id`). Useful for detail-GET routes. */
  readById?: (id: string) => Promise<CrudRecord | null>;
  /**
   * For hand-written detail routes (Tier B) where update + delete target `<collection>/:id`
   * (id in the path) instead of the makeCrud collection verbs (`PUT <collection>` with the id in
   * the body, `DELETE <collection>?id=`). When provided, the update PUT and the cleanup DELETE both
   * use `recordPath(id)` verbatim (no `?id=` is appended); read-back still goes through `readById`.
   * Defaults to the makeCrud collection-verb behavior so existing specs are unaffected.
   */
  recordPath?: (id: string) => string;
  /** Delete the fixture in `finally` (default true). */
  cleanup?: boolean;
};

async function defaultReadById(
  request: APIRequestContext,
  token: string,
  collectionPath: string,
  id: string,
): Promise<CrudRecord | null> {
  const separator = collectionPath.includes('?') ? '&' : '?';
  const response = await apiRequest(
    request,
    'GET',
    `${collectionPath}${separator}id=${encodeURIComponent(id)}&page=1&pageSize=100`,
    { token },
  );
  expect(response.status(), `read-back ${collectionPath} failed: ${response.status()}`).toBe(200);
  const body = await readJsonSafe<{ items?: CrudRecord[] } & CrudRecord>(response);
  if (Array.isArray(body?.items)) {
    return body!.items.find((item) => item.id === id) ?? null;
  }
  // Detail routes may return the record directly.
  return body && body.id === id ? (body as CrudRecord) : null;
}

/**
 * Runs the canonical create → read-back → assert → update → read-back → assert → delete
 * cycle for a makeCrud collection route and asserts every declared field persisted.
 */
export async function runCrudFormRoundTrip(config: CrudFormRoundTripConfig): Promise<void> {
  const { request, token, collectionPath } = config;
  const read = config.readById ?? ((id: string) => defaultReadById(request, token, collectionPath, id));
  let id: string | null = null;

  try {
    const createResponse = await apiRequest(request, 'POST', collectionPath, {
      token,
      data: config.create.payload,
    });
    expect(
      createResponse.status(),
      `create ${collectionPath} failed (${createResponse.status()}): ${await safeText(createResponse)}`,
    ).toBe(config.create.expectedStatus ?? 201);
    const createBody = (await readJsonSafe<CrudRecord>(createResponse)) ?? {};
    const rawId = config.idFromCreate
      ? config.idFromCreate(createBody)
      : (createBody.id ?? createBody.entityId);
    id = expectId(rawId, `create response should include an id (${collectionPath})`);

    const afterCreate = await read(id);
    expect(afterCreate, `created record ${id} should be readable from ${collectionPath}`).toBeTruthy();
    if (config.expectAfterCreate.scalars) {
      assertScalarFieldsPersisted(afterCreate as CrudRecord, config.expectAfterCreate.scalars, 'after-create');
    }
    if (config.expectAfterCreate.customFields) {
      assertCustomFieldsPersisted(afterCreate as CrudRecord, config.expectAfterCreate.customFields, 'after-create');
    }

    const updateUrl = config.recordPath ? config.recordPath(id) : collectionPath;
    const updateResponse = await apiRequest(request, 'PUT', updateUrl, {
      token,
      data: config.update.payload(id),
    });
    expect(
      updateResponse.status(),
      `update ${collectionPath} failed (${updateResponse.status()}): ${await safeText(updateResponse)}`,
    ).toBe(config.update.expectedStatus ?? 200);

    const afterUpdate = await read(id);
    expect(afterUpdate, `updated record ${id} should be readable from ${collectionPath}`).toBeTruthy();
    if (config.expectAfterUpdate.scalars) {
      assertScalarFieldsPersisted(afterUpdate as CrudRecord, config.expectAfterUpdate.scalars, 'after-update');
    }
    if (config.expectAfterUpdate.customFields) {
      assertCustomFieldsPersisted(afterUpdate as CrudRecord, config.expectAfterUpdate.customFields, 'after-update');
    }
  } finally {
    if (id && config.cleanup !== false) {
      const separator = collectionPath.includes('?') ? '&' : '?';
      const deleteUrl = config.recordPath
        ? config.recordPath(id)
        : `${collectionPath}${separator}id=${encodeURIComponent(id)}`;
      await apiRequest(request, 'DELETE', deleteUrl, {
        token,
      }).catch(() => undefined);
    }
  }
}
