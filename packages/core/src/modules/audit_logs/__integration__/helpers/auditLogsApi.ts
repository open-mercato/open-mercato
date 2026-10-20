import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { createRoleFixture, setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { createDictionaryFixture } from '@open-mercato/core/helpers/integration/dictionariesFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const ACTIONS_PATH = '/api/audit_logs/audit-logs/actions'
export const UNDO_PATH = '/api/audit_logs/audit-logs/actions/undo'
export const REDO_PATH = '/api/audit_logs/audit-logs/actions/redo'
export const EXPORT_PATH = '/api/audit_logs/audit-logs/actions/export'
export const API_KEYS_PATH = '/api/api_keys/keys'

// The dictionaries entry-create command logs under this resource kind. A
// dictionary entry create is the cheapest auditable, undoable + redoable action
// that flows through the command bus, so the audit_logs specs use it to produce
// real action-log rows with undo tokens.
export const DICTIONARY_ENTRY_RESOURCE_KIND = 'dictionaries.entry'

export type ActionLogExecutionState = 'done' | 'undone' | 'failed' | 'redone'

export type ActionLogItem = {
  id: string
  commandId: string
  executionState: ActionLogExecutionState
  actorUserId: string | null
  resourceKind: string | null
  resourceId: string | null
  undoToken: string | null
  createdAt: string
  updatedAt: string
  causeKind?: string | null
  causeId?: string | null
  correlationId?: string | null
  causedByLogId?: string | null
  context?: Record<string, unknown> | null
}

export type ActionLogCausationFrame = { kind: string; id?: string | null; ref?: string | null }

export type ActionLogListResponse = {
  items: ActionLogItem[]
  canViewTenant: boolean
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export type ActionLogQuery = Record<string, string | number | undefined>

function buildQuery(query?: ActionLogQuery): string {
  if (!query) return ''
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    params.set(key, String(value))
  }
  const serialized = params.toString()
  return serialized ? `?${serialized}` : ''
}

function uniqueToken(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`
}

/**
 * Creates a dictionary plus one entry. The entry creation flows through the
 * command bus (`dictionaries.entries.create`) and emits an undoable action log
 * with a fresh undo token. Returns the ids so callers can drive undo/redo and
 * clean up the dictionary in `finally`.
 */
export async function createAuditableDictionaryEntry(
  request: APIRequestContext,
  token: string,
  options: { keyPrefix: string; value?: string; label?: string },
): Promise<{ dictionaryId: string; entryId: string }> {
  const unique = uniqueToken(options.keyPrefix)
  const dictionaryId = await createDictionaryFixture(request, token, {
    key: `qa_${unique}`,
    name: `QA Audit ${unique}`,
  })
  const response = await apiRequest(
    request,
    'POST',
    `/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries`,
    { token, data: { value: options.value ?? `val_${unique}`, label: options.label ?? `Label ${unique}` } },
  )
  if (response.status() !== 201) {
    const detail = await response.text()
    throw new Error(`[internal] dictionary entry create failed (${response.status()}): ${detail}`)
  }
  const body = await readJsonSafe<{ id?: string }>(response)
  const entryId = body?.id
  if (typeof entryId !== 'string' || entryId.length === 0) {
    throw new Error('[internal] dictionary entry create response missing id')
  }
  return { dictionaryId, entryId }
}

export async function listActionLogs(
  request: APIRequestContext,
  token: string,
  query?: ActionLogQuery,
): Promise<{ status: number; body: ActionLogListResponse | null }> {
  const response = await apiRequest(request, 'GET', `${ACTIONS_PATH}${buildQuery(query)}`, { token })
  const body = await readJsonSafe<ActionLogListResponse>(response)
  return { status: response.status(), body }
}

/**
 * Resolves an action-log row for a given dictionary entry. Filtering by
 * `resourceKind` + `resourceId` keeps lookups deterministic even when the shared
 * database holds unrelated logs.
 *
 * NOTE: undoing an action writes a second "trace" row with the SAME resourceId,
 * so once an entry has been undone its resourceId resolves to multiple rows.
 * Pass `logId` to narrow to a specific row; without it the most recent row wins
 * (correct for the first lookup right after creation, when only one row exists).
 */
export async function findActionLog(
  request: APIRequestContext,
  token: string,
  params: { resourceId: string; logId?: string },
): Promise<ActionLogItem | null> {
  const { body } = await listActionLogs(request, token, {
    resourceKind: DICTIONARY_ENTRY_RESOURCE_KIND,
    resourceId: params.resourceId,
  })
  const items = body?.items ?? []
  if (params.logId) return items.find((item) => item.id === params.logId) ?? null
  return items.find((item) => item.resourceId === params.resourceId) ?? null
}

export async function undoAction(request: APIRequestContext, token: string, undoToken: string) {
  return apiRequest(request, 'POST', UNDO_PATH, { token, data: { undoToken } })
}

export async function redoAction(request: APIRequestContext, token: string, logId: string) {
  return apiRequest(request, 'POST', REDO_PATH, { token, data: { logId } })
}

export async function exportActionLogs(
  request: APIRequestContext,
  token: string,
  query?: ActionLogQuery,
) {
  return apiRequest(request, 'GET', `${EXPORT_PATH}${buildQuery(query)}`, { token })
}

/** Splits an exported CSV body into header + data lines (drops a trailing newline). */
export function parseCsv(body: string): { header: string; dataLines: string[] } {
  const lines = body.split('\n').filter((line, index, all) => !(line === '' && index === all.length - 1))
  return { header: lines[0] ?? '', dataLines: lines.slice(1) }
}

/** Lists every action-log row recorded for one dictionary entry, newest first. */
export async function listEntryActionLogs(
  request: APIRequestContext,
  token: string,
  entryId: string,
): Promise<ActionLogItem[]> {
  const { status, body } = await listActionLogs(request, token, {
    resourceKind: DICTIONARY_ENTRY_RESOURCE_KIND,
    resourceId: entryId,
  })
  expect(status, 'action log list should return 200').toBe(200)
  return body?.items ?? []
}

/** Reads the server-written causation frames from an action log's context. */
export function readCausationFrames(item: ActionLogItem): ActionLogCausationFrame[] {
  const causation = item.context?.causation
  if (!causation || typeof causation !== 'object' || Array.isArray(causation)) return []
  const frames = (causation as { frames?: unknown }).frames
  if (!Array.isArray(frames)) return []
  return frames.filter((frame): frame is ActionLogCausationFrame => (
    Boolean(frame) && typeof frame === 'object' && typeof (frame as { kind?: unknown }).kind === 'string'
  ))
}

function dictionaryEntryPath(dictionaryId: string, entryId: string): string {
  return `/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries/${encodeURIComponent(entryId)}`
}

export type DictionaryEntryPatch = {
  dictionaryId: string
  entryId: string
  data: Record<string, unknown>
  headers?: Record<string, string>
}

/** Updates a dictionary entry with a staff session token (`dictionaries.entries.update`). */
export async function patchDictionaryEntry(
  request: APIRequestContext,
  token: string,
  patch: DictionaryEntryPatch,
): Promise<{ status: number; text: string }> {
  const response = await apiRequest(request, 'PATCH', dictionaryEntryPath(patch.dictionaryId, patch.entryId), {
    token,
    data: patch.data,
    headers: patch.headers,
  })
  return { status: response.status(), text: await response.text() }
}

/**
 * Updates a dictionary entry authenticated only by an API key. The request runs in
 * a cookie-free context: the shared `request` fixture carries the admin session
 * cookie, which would otherwise win over the API key.
 */
export async function patchDictionaryEntryWithApiKey(
  apiKeySecret: string,
  patch: DictionaryEntryPatch,
): Promise<{ status: number; text: string }> {
  return withCredentialIsolatedRequest(async (isolatedRequest) => {
    const response = await apiRequest(isolatedRequest, 'PATCH', dictionaryEntryPath(patch.dictionaryId, patch.entryId), {
      token: '',
      data: patch.data,
      headers: { ...(patch.headers ?? {}), Authorization: `ApiKey ${apiKeySecret}` },
    })
    return { status: response.status(), text: await response.text() }
  })
}

/** Creates a role that may read and write dictionaries, for API-key fixtures. */
export async function createDictionaryWriterRole(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<string> {
  const roleId = await createRoleFixture(request, token, { name })
  await setRoleAclFeatures(request, token, {
    roleId,
    features: ['dictionaries.view', 'dictionaries.manage'],
    organizations: null,
  })
  return roleId
}

/** Creates an API key bound to one role in the caller's organization. */
export async function createApiKeyForRole(
  request: APIRequestContext,
  token: string,
  input: { name: string; roleId: string },
): Promise<{ id: string; secret: string }> {
  const { organizationId } = getTokenScope(token)
  const response = await apiRequest(request, 'POST', API_KEYS_PATH, {
    token,
    data: { name: input.name, roles: [input.roleId], organizationId },
  })
  const body = await readJsonSafe<{ id?: string; secret?: string }>(response)
  expect(response.status(), 'POST /api/api_keys/keys should return 201').toBe(201)
  return {
    id: expectId(body?.id, 'API key create response should include id'),
    secret: expectId(body?.secret, 'API key create response should include secret'),
  }
}
