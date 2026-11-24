import os from 'node:os'
import path from 'node:path'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { findAllApps, findAppRoot } from '@open-mercato/shared/lib/bootstrap/appResolver'
import type { MaintenanceExpectedProcesses } from '@open-mercato/shared/lib/maintenance/types'

export type MaintenanceStoreKind = 'auto' | 'redis' | 'file'

export type MaintenanceConfig = {
  storeKind: MaintenanceStoreKind
  stateDir: string
  pollMs: number
  heartbeatMs: number
  force: boolean
  expectedProcesses: MaintenanceExpectedProcesses | null
  timezone: string
  logoUrl: string | null
  supportUrl: string | null
  templatePath: string | null
  host: string
}

function readPositiveInt(raw: string | undefined, fallback: number, min: number): number {
  const parsed = raw ? Number(raw) : NaN
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.floor(parsed))
}

function readOptional(raw: string | undefined): string | null {
  const trimmed = raw?.trim()
  return trimmed ? trimmed : null
}

export function parseExpectedProcesses(raw: string | null | undefined): MaintenanceExpectedProcesses | null {
  if (!raw || !raw.trim()) return null
  const result: MaintenanceExpectedProcesses = { web: 0, worker: 0, scheduler: 0 }
  for (const part of raw.split(',')) {
    const [rawKey, rawValue] = part.split('=').map((value) => value?.trim())
    if (!rawKey) continue
    if (rawKey !== 'web' && rawKey !== 'worker' && rawKey !== 'scheduler') {
      throw new Error(`[internal] Unknown process kind "${rawKey}" in expected processes`)
    }
    const count = Number(rawValue)
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`[internal] Invalid expected process count for "${rawKey}"`)
    }
    result[rawKey] = count
  }
  return result
}

/**
 * The CLI may run from the monorepo root while the app runs from its own directory, so the
 * default file-store location is anchored to the Next app root, not to the working directory.
 */
export function resolveDefaultStateDir(cwd: string = process.cwd()): string {
  try {
    const appRoot = findAppRoot(cwd) ?? findAllApps(cwd)[0] ?? null
    if (appRoot) return path.join(appRoot.mercatoDir, 'maintenance')
  } catch {
    return path.join(cwd, '.mercato', 'maintenance')
  }
  return path.join(cwd, '.mercato', 'maintenance')
}

export function resolveMaintenanceConfig(env: NodeJS.ProcessEnv = process.env): MaintenanceConfig {
  const rawStore = (env.OM_MAINTENANCE_STORE ?? 'auto').trim().toLowerCase()
  const storeKind: MaintenanceStoreKind = rawStore === 'redis' || rawStore === 'file' ? rawStore : 'auto'
  let expectedProcesses: MaintenanceExpectedProcesses | null = null
  try {
    expectedProcesses = parseExpectedProcesses(env.OM_MAINTENANCE_EXPECTED_PROCESSES)
  } catch {
    expectedProcesses = null
  }
  return {
    storeKind,
    stateDir: readOptional(env.OM_MAINTENANCE_STATE_DIR) ?? resolveDefaultStateDir(),
    pollMs: readPositiveInt(env.OM_MAINTENANCE_POLL_MS, 2000, 100),
    heartbeatMs: readPositiveInt(env.OM_MAINTENANCE_HEARTBEAT_MS, 5000, 100),
    force: parseBooleanWithDefault(env.OM_MAINTENANCE_FORCE, false),
    expectedProcesses,
    timezone: readOptional(env.OM_MAINTENANCE_TIMEZONE) ?? 'UTC',
    logoUrl: readOptional(env.OM_MAINTENANCE_LOGO_URL),
    supportUrl: readOptional(env.OM_MAINTENANCE_SUPPORT_URL),
    templatePath: readOptional(env.OM_MAINTENANCE_PAGE_TEMPLATE),
    host: os.hostname(),
  }
}
