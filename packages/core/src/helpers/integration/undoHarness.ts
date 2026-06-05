import { type APIRequestContext, type APIResponse, expect } from '@playwright/test'
import { apiRequest } from './api'

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

export type Operation = {
  logId: string
  undoToken: string
  commandId: string
  resourceKind: string | null
  resourceId: string | null
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
