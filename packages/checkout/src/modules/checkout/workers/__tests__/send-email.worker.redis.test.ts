import { randomUUID } from 'node:crypto'
import { createConnection, createServer, type Socket } from 'node:net'
import Redis from 'ioredis'
import type { Queue, QueueStrategyType, AsyncQueueOptions, LocalQueueOptions } from '@open-mercato/queue'
import { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import * as rateLimitConfig from '@open-mercato/shared/lib/ratelimit/config'
import { dispatchCheckoutEmailJob } from '../../lib/emailQueue'
import handleEmail, { CHECKOUT_EMAIL_QUEUE, type CheckoutEmailJob } from '../send-email.worker'
import handleSessionStarted from '../../subscribers/session-started-email'

const mockSendEmail = jest.fn()
const mockTransactions = new Map<string, Record<string, unknown>>()
const mockLinks = new Map<string, Record<string, unknown>>()
const mockQueues: Queue<CheckoutEmailJob>[] = []
let mockQueueNamespace = ''
let mockCurrentContainer: { resolve: <T = unknown>(name: string) => T }

jest.mock('@open-mercato/shared/lib/email/send', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => mockCurrentContainer,
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: async (_em: unknown, entity: { name: string }, filter: Record<string, unknown>) => {
    const row = (entity.name === 'CheckoutTransaction' ? mockTransactions : mockLinks).get(String(filter.id))
    return row && row.tenantId === filter.tenantId && row.organizationId === filter.organizationId ? row : null
  },
}))

jest.mock('@open-mercato/core/modules/notifications/lib/deliveryConfig', () => ({
  DEFAULT_NOTIFICATION_DELIVERY_CONFIG: { strategies: { email: { enabled: true } } },
  resolveNotificationDeliveryConfig: async () => ({ strategies: { email: { enabled: true } } }),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key }),
}))

jest.mock('@open-mercato/queue', () => {
  const actual = jest.requireActual<typeof import('@open-mercato/queue')>('@open-mercato/queue')
  return {
    ...actual,
    createQueue: (name: string, strategy: QueueStrategyType, options?: AsyncQueueOptions<CheckoutEmailJob> | LocalQueueOptions<CheckoutEmailJob>) => {
      const queue = actual.createQueue<CheckoutEmailJob>(name + '-' + mockQueueNamespace, strategy, options)
      mockQueues.push(queue)
      return queue
    },
  }
})

const redisUrl = process.env.QUEUE_TEST_REDIS_URL
const describeWithRedis = redisUrl ? describe : describe.skip

async function waitUntil(condition: () => Promise<boolean>, expected: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!(await condition())) {
    if (Date.now() >= deadline) throw new Error('[internal] Timed out waiting for ' + expected)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

async function startProxy(upstreamUrl: string) {
  const upstream = new URL(upstreamUrl)
  const sockets = new Set<Socket>()
  const server = createServer((client) => {
    const remote = createConnection({ host: upstream.hostname, port: Number(upstream.port || 6379) })
    for (const socket of [client, remote]) {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    }
    client.on('error', () => remote.destroy())
    remote.on('error', () => client.destroy())
    client.pipe(remote)
    remote.pipe(client)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('[internal] Redis proxy has no TCP address')
  const url = new URL(upstreamUrl)
  url.hostname = '127.0.0.1'
  url.port = String(address.port)
  return {
    url: url.toString(),
    async close() {
      if (!server.listening) return
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    },
  }
}

describe('checkout distributed-budget CI configuration', () => {
  it('uses the existing real Redis fixture in the shared CI test job', () => {
    if (process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_JOB === 'test') expect(redisUrl).toBeDefined()
  })
})

describeWithRedis('checkout email dispatch with real shared Redis', () => {
  const scope = { tenantId: 'tenant-one', organizationId: 'org-one' }
  const previousEnvironment = { redis: process.env.REDIS_URL, queue: process.env.QUEUE_STRATEGY }
  let proxy: Awaited<ReturnType<typeof startProxy>>
  let redis: Redis
  let services: RateLimiterService[]
  let contexts: Array<{ resolve: <T = unknown>(name: string) => T }>
  let prefix: string

  beforeEach(async () => {
    jest.clearAllMocks()
    mockTransactions.clear()
    mockLinks.clear()
    mockQueues.length = 0
    mockQueueNamespace = randomUUID()
    prefix = 'checkout-budget-' + randomUUID()
    process.env.REDIS_URL = redisUrl
    process.env.QUEUE_STRATEGY = 'local'
    redis = new Redis(redisUrl!, { maxRetriesPerRequest: 1 })
    await redis.ping()
    proxy = await startProxy(redisUrl!)
    const config = { enabled: true, strategy: 'redis' as const, redisUrl: proxy.url, keyPrefix: prefix, trustProxyDepth: 0 }
    jest.spyOn(rateLimitConfig, 'readRateLimitConfig').mockReturnValue(config)
    services = [new RateLimiterService(config), new RateLimiterService(config)]
    await Promise.all(services.map((service) => service.initialize()))
    for (const service of services) {
      await waitUntil(async () => !(await service.consume('ready', {
        points: 1000, duration: 60, keyPrefix: 'readiness', requireShared: true,
      })).degraded, 'an independent Redis limiter connection')
    }
    contexts = services.map((service) => ({
      resolve: <T = unknown>(name: string): T => {
        if (name === 'em') return { fork: () => ({}) } as T
        if (name === 'rateLimiterService') return service as T
        throw new Error('[internal] Unexpected dependency: ' + name)
      },
    }))
  })

  afterEach(async () => {
    try {
      if (mockQueues.length) await mockQueues[0].clear()
      await Promise.all(mockQueues.map((queue) => queue.close()))
      await Promise.all((services ?? []).map((service) => service.destroy()))
      await proxy?.close()
      if (redis) {
        const keys = await redis.keys(prefix + ':*')
        if (keys.length) await redis.del(...keys)
        await redis.quit()
      }
    } finally {
      jest.restoreAllMocks()
      if (previousEnvironment.redis === undefined) delete process.env.REDIS_URL
      else process.env.REDIS_URL = previousEnvironment.redis
      if (previousEnvironment.queue === undefined) delete process.env.QUEUE_STRATEGY
      else process.env.QUEUE_STRATEGY = previousEnvironment.queue
    }
  })

  function fixture(type: CheckoutEmailJob['type'], options: {
    email?: string; linkId?: string; tenantId?: string; organizationId?: string
  } = {}): CheckoutEmailJob {
    const tenantId = options.tenantId ?? scope.tenantId
    const organizationId = options.organizationId ?? scope.organizationId
    const linkId = options.linkId ?? 'link-one'
    const transactionId = randomUUID()
    mockTransactions.set(transactionId, {
      id: transactionId, linkId, tenantId, organizationId,
      email: options.email ?? 'Buyer@Example.com', firstName: 'Buyer', amount: '10.00', currencyCode: 'USD',
    })
    mockLinks.set(linkId, { id: linkId, tenantId, organizationId, title: 'Fixture' })
    return { type, transactionId, tenantId, organizationId }
  }

  async function dispatch(worker: number, payload: CheckoutEmailJob) {
    mockCurrentContainer = contexts[worker]
    await dispatchCheckoutEmailJob(payload)
  }

  it('shares normalized recipient limits across independent workers and isolates tenant/organization scope', async () => {
    for (let index = 0; index < 3; index += 1) {
      await dispatch(index % 2, fixture('start', { linkId: 'link-' + index }))
    }
    await dispatch(1, fixture('start', { email: ' buyer@example.com ', linkId: 'another-link' }))
    expect(mockSendEmail).toHaveBeenCalledTimes(3)
    await dispatch(0, fixture('start', { tenantId: 'tenant-two' }))
    await dispatch(1, fixture('start', { organizationId: 'org-two' }))
    expect(mockSendEmail).toHaveBeenCalledTimes(5)
  })

  it('shares link limits across workers/recipients and isolates another link and both scopes', async () => {
    for (let index = 0; index < 100; index += 1) {
      await dispatch(index % 2, fixture('start', { email: 'buyer-' + index + '@example.com' }))
    }
    await dispatch(1, fixture('start', { email: 'next@example.com' }))
    expect(mockSendEmail).toHaveBeenCalledTimes(100)
    await dispatch(0, fixture('start', { email: 'next@example.com', linkId: 'link-two' }))
    await dispatch(1, fixture('start', { email: 'next@example.com', tenantId: 'tenant-two' }))
    await dispatch(0, fixture('start', { email: 'next@example.com', organizationId: 'org-two' }))
    expect(mockSendEmail).toHaveBeenCalledTimes(103)
  })

  it('fails closed on a real Redis outage through inline dispatch/subscriber while receipts remain available', async () => {
    await dispatch(0, fixture('start'))
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    await proxy.close()
    await expect(dispatch(1, fixture('start'))).rejects.toThrow('budget is unavailable')
    mockCurrentContainer = contexts[0]
    const payload = fixture('start')
    await expect(handleSessionStarted(payload)).resolves.toBeUndefined()
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockQueues).toHaveLength(0)
    await dispatch(0, fixture('success'))
    await dispatch(1, fixture('error'))
    expect(mockSendEmail).toHaveBeenCalledTimes(3)
  })

  it('uses real async dispatch and retries outage failures without delivering start mail or blocking receipts', async () => {
    const { createQueue } = await import('@open-mercato/queue')
    const queue = createQueue<CheckoutEmailJob>(CHECKOUT_EMAIL_QUEUE, 'async')
    const attempts: number[] = []
    await queue.process(async (job, context) => {
      if (job.payload.type === 'start') attempts.push(context.attemptNumber)
      await handleEmail(job, { ...context, resolve: contexts[context.attemptNumber % 2].resolve })
    })
    process.env.QUEUE_STRATEGY = 'async'
    await proxy.close()
    await dispatch(0, fixture('start'))
    await waitUntil(async () => (await queue.getJobCounts()).failed === 1, 'the async start job to exhaust real queue retries')
    expect(attempts).toEqual([1, 2, 3])
    expect(mockSendEmail).not.toHaveBeenCalled()
    await dispatch(0, fixture('success'))
    await dispatch(1, fixture('error'))
    await waitUntil(async () => mockSendEmail.mock.calls.length === 2, 'success and error receipts outside the start budget')
  })
})
