import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'

export type AutoSpawnWorkersMode = 'off' | 'eager' | 'lazy'

export type AutoSpawnEnvSource = Pick<NodeJS.ProcessEnv, string> | Record<string, string | undefined>

const DEFAULT_LAZY_POLL_MS = 1000
const MIN_LAZY_POLL_MS = 250

export function resolveAutoSpawnWorkersEnabled(env: AutoSpawnEnvSource = process.env): boolean {
  const legacy = parseBooleanToken(env.AUTO_SPAWN_WORKERS)
  if (legacy !== null) return legacy
  const aliased = parseBooleanToken(env.OM_AUTO_SPAWN_WORKERS)
  if (aliased !== null) return aliased
  return true
}

export function resolveAutoSpawnWorkersLazy(env: AutoSpawnEnvSource = process.env): boolean {
  return parseBooleanToken(env.OM_AUTO_SPAWN_WORKERS_LAZY) === true
}

export function resolveAutoSpawnWorkersMode(env: AutoSpawnEnvSource = process.env): AutoSpawnWorkersMode {
  if (!resolveAutoSpawnWorkersEnabled(env)) return 'off'
  if (resolveAutoSpawnWorkersLazy(env)) return 'lazy'
  return 'eager'
}

export function resolveLazyPollMs(env: AutoSpawnEnvSource = process.env): number {
  const raw = env.OM_AUTO_SPAWN_WORKERS_LAZY_POLL_MS
  if (typeof raw !== 'string' || raw.trim() === '') return DEFAULT_LAZY_POLL_MS
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LAZY_POLL_MS
  return Math.max(MIN_LAZY_POLL_MS, Math.floor(parsed))
}

export function resolveLazyRestart(env: AutoSpawnEnvSource = process.env): boolean {
  const parsed = parseBooleanToken(env.OM_AUTO_SPAWN_WORKERS_LAZY_RESTART)
  return parsed === null ? true : parsed
}
