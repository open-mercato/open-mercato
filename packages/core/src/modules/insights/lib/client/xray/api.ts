import { windowQueryParams, type XrayWindowState } from './window'

export const XRAY_API_BASE = '/api/insights/xray'
export const XRAY_PAGE_BASE = '/backend/insights/process-xray'
export const XRAY_SETTINGS_PAGE_PATH = `${XRAY_PAGE_BASE}/settings`
export const XRAY_SUGGESTIONS_PAGE_PATH = `${XRAY_PAGE_BASE}/suggestions`
export const WORKFLOW_DEFINITIONS_API_PATH = '/api/workflows/definitions'
export const WORKFLOW_COMMANDS_API_PATH = '/api/workflows/commands'
export const WORKFLOW_DEFINITION_PAGE_BASE = '/backend/definitions'

export const XRAY_PROCESS_OPERATIONS = ['map', 'variants', 'durations', 'bottlenecks', 'rework', 'conformance', 'breakdown', 'cases'] as const

export type XrayProcessOperation = (typeof XRAY_PROCESS_OPERATIONS)[number]

/** Actor and cause filters of the per-process analytics (role / team ids are UUIDs). */
export type XrayFilterState = {
  causeKinds: string[]
  includeSyncRun: boolean
  actorRoleIds: string[]
  actorTeamIds: string[]
}

export const EMPTY_XRAY_FILTERS: XrayFilterState = { causeKinds: [], includeSyncRun: false, actorRoleIds: [], actorTeamIds: [] }

export type XrayRequestError = {
  httpStatus: number | null
  code: string | null
  hint: string | null
  message: string | null
}

export type XrayRequestResult<TBody> = { ok: true; body: TBody } | { ok: false; error: XrayRequestError }

type QueryValue = string | number | boolean | null | undefined

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function buildQueryString(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue
    const text = String(value).trim()
    if (text.length === 0) continue
    search.set(key, text)
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}

export function xrayProcessApiPath(processKey: string, operation: XrayProcessOperation): string {
  return `${XRAY_API_BASE}/${encodeURIComponent(processKey)}/${operation}`
}

export function xrayProcessPagePath(processKey: string, sub?: 'cases'): string {
  const base = `${XRAY_PAGE_BASE}/${encodeURIComponent(processKey)}`
  return sub ? `${base}/${sub}` : base
}

export function xrayVariantDraftApiPath(processKey: string, variantHash: string): string {
  return `${XRAY_API_BASE}/${encodeURIComponent(processKey)}/variants/${encodeURIComponent(variantHash)}/workflow-draft`
}

export function xraySuggestionApiPath(id: string, sub?: 'draft'): string {
  const base = `${XRAY_API_BASE}/suggestions/${encodeURIComponent(id)}`
  return sub ? `${base}/${sub}` : base
}

export function workflowDefinitionPagePath(id: string): string {
  return `${WORKFLOW_DEFINITION_PAGE_BASE}/${encodeURIComponent(id)}`
}

/** CSV query parameters of the analytics filters (empty filters are omitted). */
export function filterQueryParams(filters: XrayFilterState): Record<string, string> {
  const params: Record<string, string> = {}
  if (filters.causeKinds.length > 0) params.causeKinds = filters.causeKinds.join(',')
  if (filters.actorRoleIds.length > 0) params.actorRoleIds = filters.actorRoleIds.join(',')
  if (filters.actorTeamIds.length > 0) params.actorTeamIds = filters.actorTeamIds.join(',')
  if (filters.includeSyncRun) params.includeSyncRun = 'true'
  return params
}

export function hasActorFilter(filters: XrayFilterState): boolean {
  return filters.actorRoleIds.length > 0 || filters.actorTeamIds.length > 0
}

/**
 * The URL of a per-process analytics read for the window and filters, or `null` while the
 * window is invalid (nothing is requested then).
 */
export function xrayAnalyticsUrl(
  processKey: string,
  operation: XrayProcessOperation,
  window: XrayWindowState,
  filters: XrayFilterState | null,
  extra: Record<string, QueryValue> = {},
): string | null {
  const windowParams = windowQueryParams(window)
  if (!windowParams) return null
  return `${xrayProcessApiPath(processKey, operation)}${buildQueryString({ ...windowParams, ...(filters ? filterQueryParams(filters) : {}), ...extra })}`
}

/** The error of a failed X-Ray call: HTTP status plus the route's `{ error, code, hint }` body when present. */
export function readXrayError(httpStatus: number | null, body: unknown): XrayRequestError {
  if (!isRecord(body)) return { httpStatus, code: null, hint: null, message: null }
  return { httpStatus, code: readString(body, 'code'), hint: readString(body, 'hint'), message: readString(body, 'error') }
}

export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
}
