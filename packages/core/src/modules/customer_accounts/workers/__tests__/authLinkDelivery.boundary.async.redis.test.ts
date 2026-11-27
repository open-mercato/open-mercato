/** @jest-environment node */

/**
 * `authLinkDelivery.boundary.integration.test.ts` proves the #8889 boundary — durable acceptance and
 * worker-restart retry — against the `local` queue strategy only. Production runs `QUEUE_STRATEGY=async`
 * (see UPGRADE_NOTES.md), where "the job survives a worker restart" is a materially different claim:
 * it has to survive the Redis-backed queue outliving the in-process `Queue`/`Worker` object entirely,
 * not just surviving a re-invocation of the same in-process file-based strategy.
 *
 * This suite closes that gap against a real BullMQ + Redis server, following the same opt-in pattern
 * as `packages/queue/src/__tests__/async.coalescing.redis.test.ts`: it skips unless `QUEUE_TEST_REDIS_URL`
 * is set, and CI's `test` job already provisions a Redis service and sets that variable, so this runs
 * there as part of the ordinary suite — no Testcontainers bootstrap needed on top of what the job
 * already provides.
 *
 * The "simulated worker restart" is a brand-new `Queue` object (its own BullMQ `Queue`/`Worker`
 * connection) created only after the first one is fully closed — the same process-boundary the queue
 * package's own redis suite uses to prove coalescing survives a real server, applied here to prove a
 * failed delivery survives past the worker instance that first saw it.
 */

import { createQueue, type Queue } from '@open-mercato/queue'
import {
  CustomerUserEmailVerification,
  CustomerUserPasswordReset,
} from '@open-mercato/core/modules/customer_accounts/data/entities'
import { CustomerTokenService } from '@open-mercato/core/modules/customer_accounts/services/customerTokenService'
import type { AuthLinkDeliveryJobPayload } from '@open-mercato/core/modules/customer_accounts/lib/authLinkQueue'

const redisUrl = process.env.QUEUE_TEST_REDIS_URL
const describeWithRedis = redisUrl ? describe : describe.skip

const tenantId = '11111111-1111-4111-8111-111111111111'
const orgId = '33333333-3333-4333-8333-333333333333'
const knownUserId = '22222222-2222-4222-8222-222222222222'
const knownEmail = 'buyer@example.com'
const unknownEmail = 'nobody@example.com'

type FakeEntity = {
  id: string
  token: string
  purpose?: string
  usedAt: Date | null
  expiresAt: Date
  userId: string
}

// Mirrors the in-memory stand-in from the `local`-strategy boundary suite so
// `CustomerTokenService` runs unmodified here too — only the queue strategy under test differs.
function createFakeAuthLinkEntityManager(knownUsers: Map<string, { id: string; tenantId: string }>) {
  const passwordResets = new Map<string, FakeEntity>()
  const emailVerifications = new Map<string, FakeEntity>()
  let counter = 0

  function tableFor(entityCtor: unknown): Map<string, FakeEntity> {
    if (entityCtor === CustomerUserPasswordReset) return passwordResets
    if (entityCtor === CustomerUserEmailVerification) return emailVerifications
    throw new Error(`fake EntityManager: unsupported entity ${String(entityCtor)}`)
  }

  function storeFor(tableName: string): Map<string, FakeEntity> {
    if (tableName === 'customer_user_password_resets') return passwordResets
    if (tableName === 'customer_user_email_verifications') return emailVerifications
    throw new Error(`fake EntityManager: unsupported table ${tableName}`)
  }

  const em = {
    create(entityCtor: unknown, data: Record<string, unknown>) {
      counter += 1
      const record: FakeEntity = {
        id: `fake-${counter}`,
        token: data.token as string,
        purpose: data.purpose as string | undefined,
        usedAt: null,
        expiresAt: data.expiresAt as Date,
        userId: data.user as string,
      }
      tableFor(entityCtor).set(record.id, record)
      return record
    },
    persist(_entity: unknown) {
      return { flush: async () => undefined }
    },
    async findOne(entityCtor: unknown, where: Record<string, unknown>) {
      const table = tableFor(entityCtor)
      for (const record of table.values()) {
        if (record.token !== where.token) continue
        if (where.purpose && record.purpose !== where.purpose) continue
        const user = knownUsers.get(record.userId)
        return { ...record, user }
      }
      return null
    },
    getKysely() {
      return {
        updateTable(tableName: string) {
          const table = storeFor(tableName)
          let setValues: { used_at?: Date } = {}
          const wheres: Array<[string, string, unknown]> = []
          const builder = {
            set(values: { used_at?: Date }) {
              setValues = values
              return builder
            },
            where(col: string, op: string, val: unknown) {
              wheres.push([col, op, val])
              return builder
            },
            async executeTakeFirst() {
              let numUpdatedRows = 0
              for (const record of table.values()) {
                let matches = true
                for (const [col, op, val] of wheres) {
                  if (col === 'id' && record.id !== val) matches = false
                  if (col === 'used_at' && op === 'is' && val === null && record.usedAt !== null) matches = false
                  if (col === 'expires_at' && op === '>' && !(record.expiresAt.getTime() > (val as Date).getTime())) matches = false
                }
                if (matches) {
                  record.usedAt = setValues.used_at ?? null
                  numUpdatedRows += 1
                }
              }
              return { numUpdatedRows: BigInt(numUpdatedRows) }
            },
          }
          return builder
        },
      }
    },
  }

  return em
}

async function waitUntil(condition: () => boolean, describeExpected: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`[internal] Timed out after ${timeoutMs}ms waiting for ${describeExpected}`)
    }
    await new Promise((resolve) => { setTimeout(resolve, 25) })
  }
}

const mockFindByEmail = jest.fn()
const mockSendEmail = jest.fn()
const mockUrlForCustomerOrg = jest.fn(async (_orgId: string, pathSuffix: string) => `https://portal.test${pathSuffix}`)
const mockEmit = jest.fn(async () => undefined)
const mockLoggerError = jest.fn()
const mockReportError = jest.fn()
const mockQueues: { passwordReset?: Queue<AuthLinkDeliveryJobPayload>; magicLink?: Queue<AuthLinkDeliveryJobPayload> } = {}

const knownUsers = new Map<string, { id: string; tenantId: string }>([[knownUserId, { id: knownUserId, tenantId }]])
const fakeEm = createFakeAuthLinkEntityManager(knownUsers)
const tokenService = new CustomerTokenService(fakeEm as any)
const createPasswordResetSpy = jest.spyOn(tokenService, 'createPasswordReset')
const createMagicLinkSpy = jest.spyOn(tokenService, 'createMagicLink')

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'customerUserService') return { findByEmail: mockFindByEmail }
    if (token === 'customerTokenService') return tokenService
    return null
  }),
}

jest.mock('@open-mercato/core/modules/customer_accounts/lib/authLinkQueue', () => {
  const actual = jest.requireActual('@open-mercato/core/modules/customer_accounts/lib/authLinkQueue')
  return {
    ...actual,
    getPasswordResetDeliveryQueue: () => mockQueues.passwordReset,
    getMagicLinkDeliveryQueue: () => mockQueues.magicLink,
  }
})

jest.mock('@open-mercato/core/modules/customer_accounts/lib/resolveTenantContext', () => {
  class TenantResolutionError extends Error {}
  return {
    TenantResolutionError,
    resolveTenantContext: jest.fn(async () => ({ tenantId })),
  }
})

jest.mock('@open-mercato/core/modules/customer_accounts/lib/rateLimiter', () => ({
  checkAuthRateLimit: jest.fn(async () => ({ error: null })),
  customerPasswordResetRateLimitConfig: {},
  customerPasswordResetIpRateLimitConfig: {},
  customerMagicLinkRateLimitConfig: {},
  customerMagicLinkIpRateLimitConfig: {},
}))

jest.mock('@open-mercato/core/modules/customer_accounts/lib/rateLimitIdentifier', () => ({
  readNormalizedEmailFromJsonRequest: jest.fn(async (req: Request) => {
    const body = await req.clone().json().catch(() => null)
    return body?.email ?? null
  }),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/i18n/server')
  return { ...actual, detectLocale: jest.fn(async () => 'en') }
})

jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerUrl', () => ({
  urlForCustomerOrg: (orgId: string, pathSuffix: string) => mockUrlForCustomerOrg(orgId, pathSuffix),
}))

jest.mock('@open-mercato/shared/lib/email/send', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/events', () => ({
  emitCustomerAccountsEvent: (...args: unknown[]) => mockEmit(...args),
}))

jest.mock('@open-mercato/shared/lib/logger', () => {
  const noopLogger = {
    error: (...args: unknown[]) => mockLoggerError(...args),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  }
  return { createLogger: () => ({ child: () => noopLogger, ...noopLogger }) }
})

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({
    reportError: (...args: unknown[]) => mockReportError(...args),
    captureTraceContext: () => ({}),
    continueTrace: (_carrier: unknown, _name: string, fn: () => unknown) => fn(),
    // The real async strategy checks this before loading the optional `bullmq-otel`
    // package; no OTLP backend is active in this suite, so keep it off like production
    // would with telemetry disabled.
    canUseGlobalTracePropagation: () => false,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async () => ({ id: tenantId, isActive: true })),
}))

import { POST as postPasswordResetRequest } from '@open-mercato/core/modules/customer_accounts/api/password/reset-request'
import { POST as postMagicLinkRequest } from '@open-mercato/core/modules/customer_accounts/api/magic-link/request'
import passwordResetDeliveryHandler from '@open-mercato/core/modules/customer_accounts/workers/passwordResetDelivery'
import magicLinkDeliveryHandler from '@open-mercato/core/modules/customer_accounts/workers/magicLinkDelivery'

function postJson(path: string, body: Record<string, unknown>) {
  const request = new Request(`http://localhost${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
  return path.includes('password') ? postPasswordResetRequest(request) : postMagicLinkRequest(request)
}

describeWithRedis('customer_accounts: blocked-transport / durable-acceptance boundary (#8889) — real BullMQ', () => {
  describe.each([
    {
      label: 'password reset',
      requestPath: '/api/customer_accounts/password/reset-request',
      queueName: 'customer-accounts-password-reset-delivery',
      workerHandler: passwordResetDeliveryHandler,
      createSpy: createPasswordResetSpy,
      verify: (token: string) => tokenService.verifyPasswordResetToken(token, tenantId),
      eventId: 'customer_accounts.password_reset.requested',
      assignQueue: (queue: Queue<AuthLinkDeliveryJobPayload>) => { mockQueues.passwordReset = queue },
    },
    {
      label: 'magic link',
      requestPath: '/api/customer_accounts/magic-link/request',
      queueName: 'customer-accounts-magic-link-delivery',
      workerHandler: magicLinkDeliveryHandler,
      createSpy: createMagicLinkSpy,
      verify: (token: string) => tokenService.verifyEmailToken(token, 'magic_link', tenantId),
      eventId: 'customer_accounts.magic_link.requested',
      assignQueue: (queue: Queue<AuthLinkDeliveryJobPayload>) => { mockQueues.magicLink = queue },
    },
  ])('$label', ({ requestPath, queueName, workerHandler, createSpy, verify, eventId, assignQueue }) => {
    let uniqueQueueName: string
    let queue: Queue<AuthLinkDeliveryJobPayload>

    beforeEach(async () => {
      jest.clearAllMocks()
      mockFindByEmail.mockImplementation(async (email: string) => {
        if (email.toLowerCase() === knownEmail) {
          return { id: knownUserId, organizationId: orgId, email: knownEmail, tenantId }
        }
        return null
      })
      uniqueQueueName = `${queueName}-${Math.random().toString(36).slice(2)}`
      queue = createQueue<AuthLinkDeliveryJobPayload>(uniqueQueueName, 'async', {
        connection: { url: redisUrl },
        concurrency: 1,
      })
      assignQueue(queue)
    })

    afterEach(async () => {
      await queue.clear()
      await queue.close()
    })

    it(
      'redelivers a job that failed on one worker process to a brand-new worker process after a restart, then yields a redeemable link',
      async () => {
        mockSendEmail.mockRejectedValueOnce(new Error('transport blocked'))

        const res = await postJson(requestPath, { email: knownEmail, tenantId })
        expect(res.status).toBe(200)

        // Durable acceptance under the real strategy: the route returned before any worker
        // existed, so the job must already be sitting in Redis, not merely in-process memory.
        const countsBeforeAnyWorker = await queue.getJobCounts()
        expect(countsBeforeAnyWorker.waiting + countsBeforeAnyWorker.active).toBeGreaterThan(0)

        // First "worker process": a real BullMQ Worker on this queue. It takes the one delivery
        // attempt, the attempt fails against the blocked transport, and the process exits —
        // the failure's two log lines (handler catch-and-rethrow, strategy retry logging) are
        // the deterministic signal that the attempt is fully done, not a timing guess.
        const firstWorker = createQueue<AuthLinkDeliveryJobPayload>(uniqueQueueName, 'async', {
          connection: { url: redisUrl },
          concurrency: 1,
        })
        try {
          await firstWorker.process(workerHandler as any)
          await waitUntil(() => mockLoggerError.mock.calls.length >= 2, 'the first failed delivery attempt to be logged')
        } finally {
          await firstWorker.close()
        }

        expect(createSpy).toHaveBeenCalledTimes(1)
        expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
          code: expect.stringContaining('_email_failed'),
        }))

        // The job is now in BullMQ's exponential-backoff window on the real Redis server — not
        // merely in whatever memory `firstWorker` held, which is now closed and gone.
        mockSendEmail.mockResolvedValue(undefined)

        // Second "worker process": an entirely separate Queue/Worker object, created only after
        // the first was fully closed. It never saw the first attempt — it has to find the retry
        // purely through the shared Redis-backed queue, which is exactly the guarantee a worker
        // restart in production depends on.
        const secondWorker = createQueue<AuthLinkDeliveryJobPayload>(uniqueQueueName, 'async', {
          connection: { url: redisUrl },
          concurrency: 1,
        })
        try {
          await secondWorker.process(workerHandler as any)
          await waitUntil(() => createSpy.mock.calls.length >= 2, 'the retried delivery to run on the new worker process')
        } finally {
          await secondWorker.close()
        }

        // Each attempt re-runs the handler from scratch, so the retry mints its own fresh token.
        const rawToken = await createSpy.mock.results[1]!.value
        expect(typeof rawToken).toBe('string')
        // One rejected call from the failed first attempt, one resolved call from the retry.
        expect(mockSendEmail).toHaveBeenCalledTimes(2)

        const firstRedemption = await verify(rawToken)
        expect(firstRedemption).toEqual({ userId: knownUserId, tenantId })

        const secondRedemption = await verify(rawToken)
        expect(secondRedemption).toBeNull()

        await waitUntil(() => mockEmit.mock.calls.length >= 1, 'the requested event to be emitted after delivery')
        expect(mockEmit).toHaveBeenCalledWith(eventId, expect.objectContaining({ userId: knownUserId, tenantId }))
      },
      20_000,
    )

    it(
      'silently drops an unknown account without minting or sending anything, under the real BullMQ strategy',
      async () => {
        mockSendEmail.mockResolvedValue(undefined)

        const res = await postJson(requestPath, { email: unknownEmail, tenantId })
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ ok: true })

        const worker = createQueue<AuthLinkDeliveryJobPayload>(uniqueQueueName, 'async', {
          connection: { url: redisUrl },
          concurrency: 1,
        })
        try {
          await worker.process(workerHandler as any)
          await waitUntil(() => mockFindByEmail.mock.calls.length >= 1, 'the worker to look up the unknown account')
          // Give any (absent) mint/send call a moment to surface before asserting its absence.
          await new Promise((resolve) => { setTimeout(resolve, 250) })
        } finally {
          await worker.close()
        }

        expect(createSpy).not.toHaveBeenCalled()
        expect(mockSendEmail).not.toHaveBeenCalled()
      },
      15_000,
    )
  })
})
