import { type APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { createDictionaryFixture } from '@open-mercato/core/helpers/integration/dictionariesFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const ACTIONS_PATH = '/api/audit_logs/audit-logs/actions'
export const UNDO_PATH = '/api/audit_logs/audit-logs/actions/undo'
export const REDO_PATH = '/api/audit_logs/audit-logs/actions/redo'
export const EXPORT_PATH = '/api/audit_logs/audit-logs/actions/export'

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
}

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
