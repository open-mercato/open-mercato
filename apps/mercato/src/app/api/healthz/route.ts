import type { CacheStrategy } from '@open-mercato/cache'
import type { EntityManager } from '@mikro-orm/postgresql'
import { bootstrap } from '@/bootstrap-api'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'

bootstrap()

export const dynamic = 'force-dynamic'

const HEALTHCHECK_TIMEOUT_MS = 1500
const HEALTHCHECK_CACHE_KEY = '__open_mercato_healthcheck__'

type HealthcheckDependencies = {
  createContainer: typeof createRequestContainer
  now: () => Date
  timeoutMs: number
  logger: Pick<Console, 'error'>
  cacheStrategy: () => string | undefined
}

type HealthcheckProbe = {
  name: 'database' | 'redis'
  run: () => Promise<unknown>
}

function withTimeout(probe: HealthcheckProbe, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${probe.name} healthcheck timed out`))
    }, timeoutMs)

    probe.run().then(
      () => {
        clearTimeout(timer)
        resolve()
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export function createHealthcheckHandler(
  overrides: Partial<HealthcheckDependencies> = {},
): () => Promise<Response> {
  const dependencies: HealthcheckDependencies = {
    createContainer: createRequestContainer,
    now: () => new Date(),
    timeoutMs: HEALTHCHECK_TIMEOUT_MS,
    logger: console,
    cacheStrategy: () => process.env.CACHE_STRATEGY,
    ...overrides,
  }

  return async function healthcheck(): Promise<Response> {
    const timestamp = dependencies.now().toISOString()

    try {
      const container = await dependencies.createContainer()
      const em = container.resolve<EntityManager>('em')
      const cache = container.resolve<CacheStrategy>('cache')
      const probes: HealthcheckProbe[] = [
        {
          name: 'database',
          run: () => em.getConnection().execute('SELECT 1'),
        },
        {
          name: 'redis',
          run: async () => {
            if (dependencies.cacheStrategy() === 'redis') {
              if (!cache.healthcheck) {
                throw new Error('Redis cache healthcheck is unavailable')
              }
              await cache.healthcheck()
              return
            }
            await cache.has(HEALTHCHECK_CACHE_KEY)
          },
        },
      ]

      const results = await Promise.allSettled(
        probes.map((probe) => withTimeout(probe, dependencies.timeoutMs)),
      )
      const failed = results
        .map((result, index) => ({ result, probe: probes[index] }))
        .filter((entry) => entry.result.status === 'rejected')

      if (failed.length === 0) {
        return Response.json({ status: 'ok', ts: timestamp })
      }

      for (const entry of failed) {
        dependencies.logger.error('[healthz] Infrastructure probe failed', {
          component: entry.probe.name,
          error: entry.result.status === 'rejected'
            ? entry.result.reason instanceof Error
              ? entry.result.reason.message
              : String(entry.result.reason)
            : 'unknown',
        })
      }
    } catch (error: unknown) {
      dependencies.logger.error('[healthz] Healthcheck setup failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }

    return Response.json(
      { status: 'degraded', ts: timestamp },
      { status: 503 },
    )
  }
}

export const GET = createHealthcheckHandler()
