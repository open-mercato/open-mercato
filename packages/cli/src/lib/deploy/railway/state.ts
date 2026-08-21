import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { RailwayState } from './types'

export function railwayStatePath(cwd: string, track: boolean): string {
  return resolve(cwd, '.mercato', track ? 'railway.json' : 'railway.json.local')
}

function isRailwayState(value: unknown): value is RailwayState {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    record.schemaVersion === 1 &&
    record.provider === 'railway' &&
    typeof record.projectName === 'string' &&
    typeof record.environments === 'object' &&
    record.environments !== null
  )
}

export function loadRailwayState(path: string): RailwayState | null {
  if (!existsSync(path)) return null
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!isRailwayState(parsed)) {
    throw new Error(`Unsupported or invalid Railway state file: ${path}`)
  }
  return parsed
}

export function createRailwayState(projectName: string, cliVersion: string): RailwayState {
  return {
    schemaVersion: 1,
    provider: 'railway',
    projectName,
    environments: {},
    writtenBy: { cliVersion },
  }
}

export function saveRailwayState(path: string, state: RailwayState): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporaryPath = `${path}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporaryPath, path)
}
