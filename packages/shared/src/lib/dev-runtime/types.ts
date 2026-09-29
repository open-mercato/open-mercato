export const RUNTIME_STATUS_SCHEMA_VERSION = 1 as const

export type RuntimeHealth =
  | 'starting'
  | 'ready'
  | 'degraded'
  | 'recovering'
  | 'unavailable'

export type RuntimeIssueSource = 'process' | 'log' | 'warmup' | 'probe' | 'browser'
export type RuntimeIssueSeverity = 'warning' | 'error'
export type RuntimeRecoveryAction = 'generate' | 'migrate' | 'restart'
export type DevRuntimeRecoveryAction = RuntimeRecoveryAction
export const DEV_RUNTIME_RECOVERY_ACTIONS: RuntimeRecoveryAction[] = ['generate', 'migrate', 'restart']

export type RuntimeIssue = {
  id: string
  fingerprint: string
  code: string
  source: RuntimeIssueSource
  severity: RuntimeIssueSeverity
  title: string
  detail?: string
  firstSeenAt: string
  lastSeenAt: string
  occurrences: number
  generation: number
  path?: string
  digest?: string
  recovery?: RuntimeRecoveryAction
}

export type RuntimeStatus = {
  schemaVersion: typeof RUNTIME_STATUS_SCHEMA_VERSION
  generation: number
  health: RuntimeHealth
  ready: boolean
  failed: boolean
  updatedAt: string
  upstream: {
    configuredPort: number
    actualPort?: number
    publicUrl: string
  }
  issueSummary?: RuntimeIssue
  incidents: RuntimeIssue[]
  recovery?: {
    action: RuntimeRecoveryAction
    startedAt: string
    busy: boolean
    lastExitCode?: number
  }
  legacy: {
    failureLines: string[]
    failureCommand?: string
    failureStage?: string
  }
}

export type DevRuntimeReportKind =
  | 'global-error'
  | 'window-error'
  | 'unhandled-rejection'
  | 'chunk-load-error'
  | 'request-error'

export type DevRuntimeReport = {
  kind: DevRuntimeReportKind
  message: string
  digest?: string
  path?: string
  stack?: string
  timestamp?: string
}

export const DEV_RUNTIME_TOKEN_HEADER = 'x-om-dev-runtime-token'
export const DEV_RUNTIME_TOKEN_META_NAME = 'om-dev-runtime-token'
export const DEV_RUNTIME_BANNER_META_NAME = 'om-dev-runtime-banner'
export const DEV_RUNTIME_LOGS_URL_META_NAME = 'om-dev-runtime-logs-url'
// Kebab-case on purpose: module ids are snake_case, so this segment can never
// collide with a module's `/api/<module_id>/...` routes. A leading-underscore
// path is not an option — Next.js treats `_folder` as a private folder and drops
// it from the route tree entirely.
export const DEV_RUNTIME_STATUS_PATH = '/api/dev-runtime/status'
export const DEV_RUNTIME_DIAGNOSTICS_PATH = '/api/dev-runtime/diagnostics'
export const DEV_RUNTIME_ACTIONS_PATH = '/api/dev-runtime/actions'
export const DEV_RUNTIME_LOGS_PATH = '/api/dev-runtime/logs'

export type DevRuntimeLogLine = {
  seq: number
  at: string
  generation: number
  source: string
  text: string
}

export type DevRuntimeLogSnapshot = {
  generation: number
  lines: DevRuntimeLogLine[]
  nextCursor: number
}
