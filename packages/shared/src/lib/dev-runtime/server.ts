import { appendFileSync, readFileSync } from 'node:fs'
import { timingSafeEqual } from 'node:crypto'

import type {
  DevRuntimeLogLine,
  DevRuntimeLogSnapshot,
  DevRuntimeReport,
  DevRuntimeRecoveryAction,
  RuntimeStatus,
} from './types'

export type DevRuntimeServerConfig = {
  enabled: boolean
  bannerEnabled: boolean
  token: string | null
  statusFilePath: string | null
  diagnosticsFilePath: string | null
  actionsFilePath: string | null
  logsFilePath: string | null
}

const DISABLED_CONFIG: DevRuntimeServerConfig = {
  enabled: false,
  bannerEnabled: false,
  token: null,
  statusFilePath: null,
  diagnosticsFilePath: null,
  actionsFilePath: null,
  logsFilePath: null,
}

function readFlag(value: string | undefined, fallback: boolean): boolean {
  if (typeof value !== 'string' || value.trim() === '') return fallback
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'on', 'yes', 'enabled'].includes(normalized)) return true
  if (['0', 'false', 'off', 'no', 'disabled'].includes(normalized)) return false
  return fallback
}

function readNonEmpty(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Dev diagnostics exist only while a local `yarn dev` supervisor is managing
 * this process.
 *
 * NODE_ENV is deliberately NOT the guard: `mercato dev` spawns the Next.js dev
 * server through `buildServerProcessEnvironment`, which forces
 * `NODE_ENV=production` (the same helper already forces the logging facade to
 * re-apply its dev defaults by hand). Keying off it would disable diagnostics
 * in exactly the environment they exist for.
 *
 * The real discriminator is the supervisor handshake: the per-run token and the
 * two state-file paths are injected by `createDevRuntimeSupervisor().childEnv()`
 * and exist nowhere else. A deployed `mercato server` has no supervisor, so it
 * has none of them and every route stays closed — even if someone sets
 * `OM_DEV_RUNTIME_DIAGNOSTICS` by hand.
 */
export function resolveDevRuntimeServerConfig(env: NodeJS.ProcessEnv = process.env): DevRuntimeServerConfig {
  if (!readFlag(env.OM_DEV_RUNTIME_DIAGNOSTICS, false)) return DISABLED_CONFIG

  const token = readNonEmpty(env.OM_DEV_RUNTIME_TOKEN)
  const statusFilePath = readNonEmpty(env.OM_DEV_RUNTIME_STATUS_FILE)
  const diagnosticsFilePath = readNonEmpty(env.OM_DEV_RUNTIME_DIAGNOSTICS_FILE)
  if (!token || !statusFilePath || !diagnosticsFilePath) return DISABLED_CONFIG

  return {
    enabled: true,
    bannerEnabled: readFlag(env.OM_DEV_RUNTIME_BANNER, true),
    token,
    statusFilePath,
    diagnosticsFilePath,
    // Absent when the supervisor predates the action channel; the actions route
    // then reports itself unavailable rather than silently dropping requests.
    actionsFilePath: readNonEmpty(env.OM_DEV_RUNTIME_ACTIONS_FILE),
    logsFilePath: readNonEmpty(env.OM_DEV_RUNTIME_LOGS_FILE),
  }
}

export function isMatchingDevRuntimeToken(expected: string | null, provided: string | null): boolean {
  if (!expected || !provided) return false
  const expectedBuffer = Buffer.from(expected)
  const providedBuffer = Buffer.from(provided)
  if (expectedBuffer.length !== providedBuffer.length) return false
  return timingSafeEqual(expectedBuffer, providedBuffer)
}

type SupervisorStatusFile = {
  token?: unknown
  pid?: unknown
  status?: unknown
}

function isRuntimeStatus(value: unknown): value is RuntimeStatus {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RuntimeStatus>
  return typeof candidate.health === 'string'
    && typeof candidate.generation === 'number'
    && Array.isArray(candidate.incidents)
}

/**
 * Reads the supervisor-owned status file. The route never derives status from
 * application state, so it cannot leak module, tenant, or organization data.
 */
export function readDevRuntimeStatus(config: DevRuntimeServerConfig): RuntimeStatus | null {
  if (!config.enabled || !config.statusFilePath) return null
  let parsed: SupervisorStatusFile
  try {
    parsed = JSON.parse(readFileSync(config.statusFilePath, 'utf8')) as SupervisorStatusFile
  } catch {
    return null
  }
  // A status file written by a different run must not be served: its token is
  // stale and its generation would confuse the banner.
  if (typeof parsed.token !== 'string' || !isMatchingDevRuntimeToken(config.token, parsed.token)) return null
  return isRuntimeStatus(parsed.status) ? parsed.status : null
}

export function appendDevRuntimeReport(config: DevRuntimeServerConfig, report: DevRuntimeReport): boolean {
  if (!config.enabled || !config.diagnosticsFilePath) return false
  try {
    appendFileSync(config.diagnosticsFilePath, `${JSON.stringify(report)}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}

export function appendDevRuntimeActionRequest(
  config: DevRuntimeServerConfig,
  request: { action: DevRuntimeRecoveryAction; generation?: number; requestedAt: string },
): boolean {
  if (!config.enabled || !config.actionsFilePath) return false
  try {
    appendFileSync(config.actionsFilePath, `${JSON.stringify(request)}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}

/**
 * Reads the supervisor-published log tail. Lines are already bounded and
 * redacted by the collector; this only filters by cursor so the logs view can
 * poll incrementally.
 */
export function readDevRuntimeLogs(
  config: DevRuntimeServerConfig,
  cursor = 0,
): DevRuntimeLogSnapshot | null {
  if (!config.enabled || !config.logsFilePath) return null
  let parsed: { token?: unknown; generation?: unknown; lines?: unknown }
  try {
    parsed = JSON.parse(readFileSync(config.logsFilePath, 'utf8'))
  } catch {
    return null
  }
  if (typeof parsed.token !== 'string' || !isMatchingDevRuntimeToken(config.token, parsed.token)) return null
  if (!Array.isArray(parsed.lines)) return null

  const from = Number.isInteger(cursor) && cursor >= 0 ? cursor : 0
  const lines = (parsed.lines as DevRuntimeLogLine[]).filter((line) => (
    line && typeof line === 'object' && typeof line.text === 'string' && Number(line.seq) > from
  ))
  return {
    generation: typeof parsed.generation === 'number' ? parsed.generation : 0,
    lines,
    nextCursor: lines.length > 0 ? Number(lines[lines.length - 1].seq) : from,
  }
}
