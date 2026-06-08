jest.mock('@/bootstrap', () => ({
  bootstrap: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

import { createHealthcheckHandler } from '../route'

type ProbeOptions = {
  database?: () => Promise<unknown>
  redis?: () => Promise<boolean>
}

function createContainer(options: ProbeOptions = {}) {
  const database = options.database ?? (async () => [{ '?column?': 1 }])
  const redis = options.redis ?? (async () => false)

  return async () => ({
    resolve: (name: string) => {
      if (name === 'em') {
        return {
          getConnection: () => ({ execute: database }),
        }
      }
      if (name === 'cache') {
        return { has: redis }
      }
      throw new Error(`Unexpected dependency: ${name}`)
    },
  })
}

describe('GET /api/healthz', () => {
  const now = () => new Date('2026-06-05T10:00:00.000Z')
  const logger = { error: jest.fn() }

  beforeEach(() => {
    logger.error.mockClear()
  })

  it('returns 200 when database and Redis probes succeed', async () => {
    const handler = createHealthcheckHandler({
      createContainer: createContainer() as never,
      now,
      logger,
    })

    const response = await handler()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'ok',
      ts: '2026-06-05T10:00:00.000Z',
    })
  })

  it.each([
    ['database', { database: async () => { throw new Error('database unavailable') } }],
    ['redis', { redis: async () => { throw new Error('redis unavailable') } }],
  ])('returns 503 when the %s probe fails', async (_component, options) => {
    const handler = createHealthcheckHandler({
      createContainer: createContainer(options) as never,
      now,
      logger,
    })

    const response = await handler()
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body).toEqual({
      status: 'degraded',
      ts: '2026-06-05T10:00:00.000Z',
    })
    expect(Object.keys(body)).toEqual(['status', 'ts'])
  })

  it('returns 503 when a probe exceeds the timeout', async () => {
    const handler = createHealthcheckHandler({
      createContainer: createContainer({
        database: () => new Promise(() => undefined),
      }) as never,
      now,
      timeoutMs: 5,
      logger,
    })

    const response = await handler()

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      status: 'degraded',
      ts: '2026-06-05T10:00:00.000Z',
    })
  })

  it('returns 503 when Redis is configured but the cache fell back without a probe', async () => {
    const handler = createHealthcheckHandler({
      createContainer: createContainer() as never,
      cacheStrategy: () => 'redis',
      now,
      logger,
    })

    const response = await handler()

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      status: 'degraded',
      ts: '2026-06-05T10:00:00.000Z',
    })
  })
})
