import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'

export async function drainSyncQueue(
  queueName: string,
  drain: (queueName: string) => Promise<number>,
  env: Partial<Pick<NodeJS.ProcessEnv, 'AUTO_SPAWN_WORKERS' | 'OM_AUTO_SPAWN_WORKERS'>> = process.env,
): Promise<number> {
  const autoSpawnWorkers = parseBooleanToken(env.AUTO_SPAWN_WORKERS)
    ?? parseBooleanToken(env.OM_AUTO_SPAWN_WORKERS)
    ?? true
  if (autoSpawnWorkers) return 0
  return drain(queueName)
}
