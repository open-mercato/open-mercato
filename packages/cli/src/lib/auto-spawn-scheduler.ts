import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'

export type AutoSpawnSchedulerMode = 'off' | 'eager' | 'lazy'

export type AutoSpawnSchedulerEnvSource = Pick<NodeJS.ProcessEnv, string> | Record<string, string | undefined>

const DEFAULT_LAZY_SCHEDULER_POLL_MS = 1000
const MIN_LAZY_SCHEDULER_POLL_MS = 250

export function resolveAutoSpawnSchedulerEnabled(env: AutoSpawnSchedulerEnvSource = process.env): boolean {
  const legacy = parseBooleanToken(env.AUTO_SPAWN_SCHEDULER)
  if (legacy !== null) return legacy
  const aliased = parseBooleanToken(env.OM_AUTO_SPAWN_SCHEDULER)
  if (aliased !== null) return aliased
  return true
}

export function resolveAutoSpawnSchedulerLazy(env: AutoSpawnSchedulerEnvSource = process.env): boolean {
  return parseBooleanToken(env.OM_AUTO_SPAWN_SCHEDULER_LAZY) === true
}

export function resolveAutoSpawnSchedulerMode(env: AutoSpawnSchedulerEnvSource = process.env): AutoSpawnSchedulerMode {
  if (!resolveAutoSpawnSchedulerEnabled(env)) return 'off'
  if (resolveAutoSpawnSchedulerLazy(env)) return 'lazy'
  return 'eager'
}

export function resolveLazySchedulerPollMs(env: AutoSpawnSchedulerEnvSource = process.env): number {
  const raw = env.OM_AUTO_SPAWN_SCHEDULER_LAZY_POLL_MS
  if (typeof raw !== 'string' || raw.trim() === '') return DEFAULT_LAZY_SCHEDULER_POLL_MS
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LAZY_SCHEDULER_POLL_MS
  return Math.max(MIN_LAZY_SCHEDULER_POLL_MS, Math.floor(parsed))
}

export function resolveLazySchedulerRestart(env: AutoSpawnSchedulerEnvSource = process.env): boolean {
  const parsed = parseBooleanToken(env.OM_AUTO_SPAWN_SCHEDULER_LAZY_RESTART)
  return parsed === null ? true : parsed
}
