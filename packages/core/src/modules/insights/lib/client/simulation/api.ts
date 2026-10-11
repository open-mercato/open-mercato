import type { SimulationIssue, SimulationRequestError, SimulationRunStatus } from './types'

export const SIMULATION_API_BASE = '/api/insights/simulations'
export const SIMULATION_CAPABILITIES_API_PATH = `${SIMULATION_API_BASE}/capabilities`
export const SIMULATION_PAGE_BASE = '/backend/insights/simulations'

export const SIMULATION_RUN_RESOURCE_KIND = 'insights.simulation_run'
export const SIMULATION_DECISION_RESOURCE_KIND = 'insights.simulation_decision'

export const RULE_BACKTEST_SIMULATION_KIND = 'business_rules.rule_backtest'
export const TRIGGER_BACKTEST_SIMULATION_KIND = 'workflows.trigger_backtest'
export const ROLE_ACL_PREVIEW_SIMULATION_KIND = 'auth.role_acl_preview'

export const SIMULATION_POLL_INTERVAL_MS = 2000
export const SIMULATION_LIST_PAGE_SIZE = 20
export const SIMULATION_WINDOW_DAY_OPTIONS = [30, 90, 180, 365] as const
export const SIMULATION_RUN_ID_QUERY_PARAM = 'simulationRunId'
export const SIMULATION_RECORDS_PAGE_SIZE = 50

const ACTIVE_STATUSES: ReadonlySet<SimulationRunStatus> = new Set<SimulationRunStatus>(['queued', 'running'])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_ISSUES = 20

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function isSimulationRunId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

export function isActiveSimulationStatus(status: SimulationRunStatus | null | undefined): boolean {
  return status !== null && status !== undefined && ACTIVE_STATUSES.has(status)
}

export function simulationRunApiPath(runId: string, sub?: 'cancel' | 'decision' | 'records'): string {
  const base = `${SIMULATION_API_BASE}/${encodeURIComponent(runId)}`
  return sub ? `${base}/${sub}` : base
}

/** One page of the live records of a completed run (`GET …/{id}/records`). */
export function simulationRecordsApiPath(runId: string, page: number, pageSize: number = SIMULATION_RECORDS_PAGE_SIZE): string {
  const params = new URLSearchParams({ page: String(Math.max(1, Math.floor(page))), pageSize: String(pageSize) })
  return `${simulationRunApiPath(runId, 'records')}?${params.toString()}`
}

export function simulationRunPagePath(runId: string): string {
  return `${SIMULATION_PAGE_BASE}/${encodeURIComponent(runId)}`
}

export function simulationListApiPath(page: number, pageSize: number = SIMULATION_LIST_PAGE_SIZE): string {
  const params = new URLSearchParams({ page: String(Math.max(1, Math.floor(page))), pageSize: String(pageSize) })
  return `${SIMULATION_API_BASE}?${params.toString()}`
}

/** The module that owns a simulation kind (`business_rules.rule_backtest` → `business_rules`). */
export function simulationKindModule(kind: string): string | null {
  const separator = kind.indexOf('.')
  return separator > 0 ? kind.slice(0, separator) : null
}

/** The default history window offered for a new run: the server default when it is one of the options. */
export function defaultSimulationWindowDays(defaultWindowDays: number | null | undefined, maxWindowDays?: number | null): number {
  const options = SIMULATION_WINDOW_DAY_OPTIONS.filter((days) => !maxWindowDays || days <= maxWindowDays)
  if (typeof defaultWindowDays === 'number' && options.some((days) => days === defaultWindowDays)) return defaultWindowDays
  return options.includes(90) ? 90 : options[0] ?? SIMULATION_WINDOW_DAY_OPTIONS[0]
}

function readIssues(value: unknown): SimulationIssue[] {
  if (!Array.isArray(value)) return []
  const issues: SimulationIssue[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const message = readString(entry, 'message')
    if (!message) continue
    issues.push({ path: typeof entry.path === 'string' ? entry.path : '', message })
    if (issues.length >= MAX_ISSUES) break
  }
  return issues
}

/** The error of a failed simulation read: HTTP status plus the route's `{ error, code, issues }` body. */
export function readSimulationError(httpStatus: number | null, body: unknown): SimulationRequestError {
  if (!isRecord(body)) return { httpStatus, code: null, message: null, issues: [] }
  return { httpStatus, code: readString(body, 'code'), message: readString(body, 'error'), issues: readIssues(body.issues) }
}

/** The same fields from an error thrown by `apiCallOrThrow` (the route body is spread onto it). */
export function readSimulationMutationError(error: unknown): SimulationRequestError {
  if (!isRecord(error)) return { httpStatus: null, code: null, message: null, issues: [] }
  const record = error
  const httpStatus = typeof record.status === 'number' ? record.status : null
  const message = readString(record, 'error') ?? (error instanceof Error && error.message ? error.message : null)
  return { httpStatus, code: readString(record, 'code'), message, issues: readIssues(record.issues) }
}

export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
}
