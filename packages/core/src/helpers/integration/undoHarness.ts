import { type APIRequestContext, type APIResponse, expect, test } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { apiRequest } from './api'
import { expectId, readJsonSafe } from './generalFixtures'

/**
 * Shared harness for verifying Undo/Redo correctness against the real command bus.
 *
 * Every mutating Open Mercato API response carries the operation metadata in the
 * `x-om-operation` header (`omop:<urlencoded JSON>`) containing the `undoToken` and the
 * audit log `id` (used as `logId` for redo). These helpers extract that envelope and drive
 * the real undo/redo endpoints so tests can assert full state restoration per TC-UNDO-001.
 */

const HEADER_PREFIX = 'omop:'
const UNDO_PATH = '/api/audit_logs/audit-logs/actions/undo'
const REDO_PATH = '/api/audit_logs/audit-logs/actions/redo'
const ACTIONS_PATH = '/api/audit_logs/audit-logs/actions'
export const UNDO_TESTS_DISABLED_ENV = 'OM_INTEGRATION_UNDO_TESTS_DISABLED'

export type Operation = {
  logId: string
  undoToken: string
  commandId: string
  resourceKind: string | null
  resourceId: string | null
}

export type CrudUndoEntityConfig = {
  label: string
  collectionPath: string
  field: string
  createPayload: (stamp: string) => Record<string, unknown>
  updatePayload: (id: string, stamp: string) => Record<string, unknown>
  readPath?: (id: string) => string
  deletePath?: (id: string) => string
  createStatus?: number
  updateStatus?: number
}

export function undoTestsDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseBooleanWithDefault(env[UNDO_TESTS_DISABLED_ENV], false)
}

export function skipIfUndoTestsDisabled(): void {
  test.skip(undoTestsDisabled(), `${UNDO_TESTS_DISABLED_ENV} is set — undo/redo integration tests skipped`)
}

/** Parse the `x-om-operation` header into a structured operation, or null when absent/malformed. */
export function extractOperation(response: APIResponse): Operation | null {
  const header = response.headers()['x-om-operation']
  if (!header || typeof header !== 'string') return null
  const trimmed = header.startsWith(HEADER_PREFIX) ? header.slice(HEADER_PREFIX.length) : header
  try {
    const parsed = JSON.parse(decodeURIComponent(trimmed)) as Record<string, unknown>
    if (typeof parsed.id !== 'string' || typeof parsed.commandId !== 'string') return null
    if (typeof parsed.undoToken !== 'string' || !parsed.undoToken) return null
    return {
      logId: parsed.id,
      undoToken: parsed.undoToken,
      commandId: parsed.commandId,
      resourceKind: (parsed.resourceKind as string) ?? null,
      resourceId: (parsed.resourceId as string) ?? null,
    }
  } catch {
    return null
  }
}

/** Like extractOperation but fails the test if no undo token was issued. */
export function expectOperation(response: APIResponse, context: string): Operation {
  const op = extractOperation(response)
  expect(op, `Expected an undo token (x-om-operation header) for ${context}, got none`).toBeTruthy()
  return op as Operation
}

export async function undoByToken(request: APIRequestContext, token: string, undoToken: string): Promise<APIResponse> {
  return apiRequest(request, 'POST', UNDO_PATH, { token, data: { undoToken } })
}

export async function redoByLogId(request: APIRequestContext, token: string, logId: string): Promise<APIResponse> {
  return apiRequest(request, 'POST', REDO_PATH, { token, data: { logId } })
}

/** Undo and assert success; returns the resolved logId. */
export async function undoOk(request: APIRequestContext, token: string, undoToken: string, context: string): Promise<string> {
  const res = await undoByToken(request, token, undoToken)
  const body = (await res.json().catch(() => null)) as { ok?: boolean; logId?: string } | null
  expect(res.ok(), `Undo failed for ${context}: status ${res.status()} body ${JSON.stringify(body)}`).toBeTruthy()
  expect(body?.ok, `Undo not ok for ${context}: ${JSON.stringify(body)}`).toBeTruthy()
  return body?.logId as string
}

/** Redo and assert success; returns the new operation (new undoToken + logId). */
export async function redoOk(request: APIRequestContext, token: string, logId: string, context: string): Promise<{ logId: string; undoToken: string | null }> {
  const res = await redoByLogId(request, token, logId)
  const body = (await res.json().catch(() => null)) as { ok?: boolean; logId?: string; undoToken?: string } | null
  expect(res.ok(), `Redo failed for ${context}: status ${res.status()} body ${JSON.stringify(body)}`).toBeTruthy()
  expect(body?.ok, `Redo not ok for ${context}: ${JSON.stringify(body)}`).toBeTruthy()
  return { logId: body?.logId as string, undoToken: body?.undoToken ?? null }
}

/** Assert that undoing an already-consumed token is rejected (token consumption / no double-undo). */
export async function expectTokenConsumed(request: APIRequestContext, token: string, undoToken: string, context: string): Promise<void> {
  const res = await undoByToken(request, token, undoToken)
  expect(res.ok(), `Expected double-undo to be rejected for ${context}, but it succeeded`).toBeFalsy()
}

/** Fetch undoable actions list (for Version History assertions). */
export async function listUndoable(request: APIRequestContext, token: string, params: Record<string, string> = {}): Promise<unknown> {
  const qs = new URLSearchParams({ undoableOnly: 'true', ...params }).toString()
  const res = await apiRequest(request, 'GET', `${ACTIONS_PATH}?${qs}`, { token })
  return res.json().catch(() => null)
}

/**
 * Deep-equality assertion for a selected set of fields between two entity snapshots.
 * Reports the first mismatching field with context for clear bug triage.
 */
export function assertFieldsEqual(
  actual: Record<string, unknown> | null | undefined,
  expected: Record<string, unknown> | null | undefined,
  fields: string[],
  context: string,
): void {
  expect(actual, `${context}: actual entity missing`).toBeTruthy()
  expect(expected, `${context}: expected entity missing`).toBeTruthy()
  for (const field of fields) {
    expect(
      JSON.stringify((actual as Record<string, unknown>)[field]),
      `${context}: field "${field}" not restored (expected ${JSON.stringify((expected as Record<string, unknown>)[field])}, got ${JSON.stringify((actual as Record<string, unknown>)[field])})`,
    ).toBe(JSON.stringify((expected as Record<string, unknown>)[field]))
  }
}

function findRecord(body: unknown, id: string): Record<string, unknown> | null {
  if (!body || typeof body !== 'object') return null
  if (!Array.isArray(body) && (body as Record<string, unknown>).id === id) {
    return body as Record<string, unknown>
  }
  for (const value of Array.isArray(body) ? body : Object.values(body)) {
    const found = findRecord(value, id)
    if (found) return found
  }
  return null
}

async function readRecord(
  request: APIRequestContext,
  token: string,
  entity: CrudUndoEntityConfig,
  id: string,
): Promise<Record<string, unknown> | null> {
  const path = entity.readPath?.(id) ?? `${entity.collectionPath}?id=${encodeURIComponent(id)}`
  const response = await apiRequest(request, 'GET', path, { token })
  const body = await readJsonSafe(response)
  if (!response.ok()) return null
  return findRecord(body, id)
}

function fieldValue(record: Record<string, unknown> | null, field: string): unknown {
  return record?.[field]
}

async function deleteEntity(
  request: APIRequestContext,
  token: string,
  entity: CrudUndoEntityConfig,
  id: string,
): Promise<APIResponse> {
  const path = entity.deletePath?.(id) ?? `${entity.collectionPath}?id=${encodeURIComponent(id)}`
  return apiRequest(request, 'DELETE', path, { token })
}

export async function runCrudUndoRoundTrip(
  request: APIRequestContext,
  token: string,
  entity: CrudUndoEntityConfig,
): Promise<void> {
  const stamp = `${Date.now()}${randomInt(1000)}`
  let createUndoId: string | null = null
  let cycleId: string | null = null

  try {
    const createUndoRes = await apiRequest(request, 'POST', entity.collectionPath, {
      token,
      data: entity.createPayload(`${stamp}a`),
    })
    expect(createUndoRes.status(), `${entity.label} create-for-undo status`).toBe(entity.createStatus ?? 201)
    const createUndoOp = expectOperation(createUndoRes, `${entity.label}.create`)
    createUndoId = createUndoOp.resourceId || expectId((await readJsonSafe<Record<string, unknown>>(createUndoRes))?.id, `${entity.label} create id`)
    expect(fieldValue(await readRecord(request, token, entity, createUndoId), entity.field), `${entity.label} field readable after create`).toBeDefined()

    await undoOk(request, token, createUndoOp.undoToken, `${entity.label} undo create`)
    expect(await readRecord(request, token, entity, createUndoId), `${entity.label} create→undo soft-deletes/removes the record (I3)`).toBeNull()
    await expectTokenConsumed(request, token, createUndoOp.undoToken, `${entity.label} create token consumed (I5)`)

    const createRes = await apiRequest(request, 'POST', entity.collectionPath, {
      token,
      data: entity.createPayload(`${stamp}b`),
    })
    expect(createRes.status(), `${entity.label} create status`).toBe(entity.createStatus ?? 201)
    const createOp = expectOperation(createRes, `${entity.label}.create`)
    cycleId = createOp.resourceId || expectId((await readJsonSafe<Record<string, unknown>>(createRes))?.id, `${entity.label} cycle id`)

    const beforeUpdate = await readRecord(request, token, entity, cycleId)
    const beforeValue = fieldValue(beforeUpdate, entity.field)
    expect(beforeValue, `${entity.label} field readable before update`).toBeDefined()

    const updateRes = await apiRequest(request, 'PUT', entity.collectionPath, {
      token,
      data: entity.updatePayload(cycleId, stamp),
    })
    expect(updateRes.status(), `${entity.label} update status`).toBe(entity.updateStatus ?? 200)
    const updateOp = expectOperation(updateRes, `${entity.label}.update`)
    const afterUpdate = await readRecord(request, token, entity, cycleId)
    const afterUpdateValue = fieldValue(afterUpdate, entity.field)
    expect(JSON.stringify(afterUpdateValue), `${entity.label} field changed by update`).not.toBe(JSON.stringify(beforeValue))

    await new Promise((resolve) => setTimeout(resolve, 10))
    await undoOk(request, token, updateOp.undoToken, `${entity.label} undo update`)
    const afterUndo = await readRecord(request, token, entity, cycleId)
    expect(JSON.stringify(fieldValue(afterUndo, entity.field)), `${entity.label} update→undo restores ${entity.field} (I1)`).toBe(JSON.stringify(beforeValue))
    if (typeof beforeUpdate?.updatedAt === 'string' && typeof afterUndo?.updatedAt === 'string') {
      expect(afterUndo.updatedAt, `${entity.label} undo bumps updatedAt`).not.toBe(beforeUpdate.updatedAt)
    }

    await redoOk(request, token, updateOp.logId, `${entity.label} redo update`)
    expect(JSON.stringify(fieldValue(await readRecord(request, token, entity, cycleId), entity.field)), `${entity.label} redo re-applies update (I6)`).toBe(JSON.stringify(afterUpdateValue))

    const deleteRes = await deleteEntity(request, token, entity, cycleId)
    expect(deleteRes.ok(), `${entity.label} delete status ${deleteRes.status()}`).toBeTruthy()
    const deleteOp = expectOperation(deleteRes, `${entity.label}.delete`)
    expect(await readRecord(request, token, entity, cycleId), `${entity.label} deleted record should not read`).toBeNull()

    await undoOk(request, token, deleteOp.undoToken, `${entity.label} undo delete`)
    expect(fieldValue(await readRecord(request, token, entity, cycleId), entity.field), `${entity.label} delete→undo re-materializes (I2)`).toBeDefined()
  } finally {
    if (createUndoId) await deleteEntity(request, token, entity, createUndoId).catch(() => {})
    if (cycleId) await deleteEntity(request, token, entity, cycleId).catch(() => {})
  }
}
