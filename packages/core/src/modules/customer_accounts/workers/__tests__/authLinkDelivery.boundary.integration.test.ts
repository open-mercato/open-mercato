/** @jest-environment node */

/**
 * Integration coverage for the #8889 security boundary that the unit tests in
 * `reset-request.route.test.ts` / `request.route.test.ts` / `passwordResetDelivery.test.ts` /
 * `magicLinkDelivery.test.ts` cannot establish on their own: those tests mock the queue helper and
 * the worker's dependencies independently, so they prove each unit's intended calls but never run
 * the real route handler, a real `@open-mercato/queue` local queue, and the real worker together
 * against a transport that is deliberately held open.
 *
 * Only the outbound email transport (`sendEmail`) and the DB-backed services are faked here; the
 * route handlers, the queue (local strategy), and `CustomerTokenService` (backed by an in-memory
 * stand-in for its two tables) are the real production code.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createQueue, type Queue } from '@open-mercato/queue'
import {
  CustomerUserEmailVerification,
  CustomerUserPasswordReset,
} from '@open-mercato/core/modules/customer_accounts/data/entities'
import { CustomerTokenService } from '@open-mercato/core/modules/customer_accounts/services/customerTokenService'
import type { AuthLinkDeliveryJobPayload } from '@open-mercato/core/modules/customer_accounts/lib/authLinkQueue'

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

// A minimal in-memory stand-in for the two tables `CustomerTokenService` writes to and reads from
// (via MikroORM's `EntityManager` and the raw Kysely "claim" update it runs). It implements only
// the surface those two methods call — `create`, `persist().flush()`, `findOne`, `getKysely()` —
// so `CustomerTokenService` itself runs unmodified: mint and single-use redemption are exercised as
// real production code, not re-asserted against a mock.
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

function createDeferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
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
  // The real queue strategy's own logger (not just the worker's) runs through
  // this mock too — it logs `info`/`warn` on the success path, which a
  // too-narrow mock would make throw and misreport as a job failure.
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
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async () => ({ id: tenantId, isActive: true })),
}))

import { POST as postPasswordResetRequest } from '@open-mercato/core/modules/customer_accounts/api/password/reset-request'
import { POST as postMagicLinkRequest } from '@open-mercato/core/modules/customer_accounts/api/magic-link/request'
import passwordResetDeliveryHandler from '@open-mercato/core/modules/customer_accounts/workers/passwordResetDelivery'
import magicLinkDeliveryHandler from '@open-mercato/core/modules/customer_accounts/workers/magicLinkDelivery'

const ctx = { jobId: 'job-1', attemptNumber: 1, queueName: 'test', resolve: jest.fn() }

function postJson(path: string, body: Record<string, unknown>) {
  const request = new Request(`http://localhost${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
  return path.includes('password') ? postPasswordResetRequest(request) : postMagicLinkRequest(request)
}

describe('customer_accounts: blocked-transport / durable-acceptance boundary (#8889)', () => {
  let tmpDirs: string[] = []

  beforeAll(() => {
    const passwordResetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-queue-password-reset-'))
    const magicLinkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-queue-magic-link-'))
    tmpDirs = [passwordResetDir, magicLinkDir]
    mockQueues.passwordReset = createQueue<AuthLinkDeliveryJobPayload>(
      'customer-accounts-password-reset-delivery',
      'local',
      { baseDir: passwordResetDir },
    )
    mockQueues.magicLink = createQueue<AuthLinkDeliveryJobPayload>(
      'customer-accounts-magic-link-delivery',
      'local',
      { baseDir: magicLinkDir },
    )
  })

  afterAll(() => {
    for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    jest.clearAllMocks()
    mockFindByEmail.mockImplementation(async (email: string) => {
      if (email.toLowerCase() === knownEmail) {
        return { id: knownUserId, organizationId: orgId, email: knownEmail, tenantId }
      }
      return null
    })
    await mockQueues.passwordReset!.clear()
    await mockQueues.magicLink!.clear()
  })

  describe.each([
    {
      label: 'password reset',
      requestPath: '/api/customer_accounts/password/reset-request',
      queue: () => mockQueues.passwordReset!,
      workerHandler: passwordResetDeliveryHandler,
      createSpy: createPasswordResetSpy,
      verify: (token: string) => tokenService.verifyPasswordResetToken(token, tenantId),
      failureCode: 'customer_accounts.password_reset_email_failed',
      eventId: 'customer_accounts.password_reset.requested',
    },
    {
      label: 'magic link',
      requestPath: '/api/customer_accounts/magic-link/request',
      queue: () => mockQueues.magicLink!,
      workerHandler: magicLinkDeliveryHandler,
      createSpy: createMagicLinkSpy,
      verify: (token: string) => tokenService.verifyEmailToken(token, 'magic_link', tenantId),
      failureCode: 'customer_accounts.magic_link_email_failed',
      eventId: 'customer_accounts.magic_link.requested',
    },
  ])('$label', ({ requestPath, queue, workerHandler, createSpy, verify, failureCode, eventId }) => {
    it('accepts the request while the transport is held open indefinitely, identically for a known and an unknown account', async () => {
      const held = createDeferred<void>()
      mockSendEmail.mockImplementation(() => held.promise)

      // Five repeated samples per account rules out a single fast-but-flaky
      // sample, without comparing against any fixed millisecond threshold: the
      // transport is never released during this test, so if acceptance ever
      // depended on delivery, every one of these ten calls would hang until the
      // suite's own timeout — a structural proof, not a timing guess.
      for (let i = 0; i < 5; i += 1) {
        const knownRes = await postJson(requestPath, { email: knownEmail, tenantId })
        const unknownRes = await postJson(requestPath, { email: unknownEmail, tenantId })
        expect(knownRes.status).toBe(200)
        expect(unknownRes.status).toBe(200)
        expect(await knownRes.json()).toEqual({ ok: true })
        expect(await unknownRes.json()).toEqual({ ok: true })
      }

      // The worker never ran (nothing drained the queue), so the held transport
      // was genuinely never exercised — the acceptance above cannot have been
      // waiting on it.
      expect(mockSendEmail).not.toHaveBeenCalled()
      expect(mockFindByEmail).not.toHaveBeenCalled()

      held.resolve()
    })

    it('does not widen the known-account response relative to the unknown-account one as the held transport delay grows', async () => {
      // A relative comparison instead of an absolute threshold: whatever the
      // transport's hold time is, acceptance for both accounts must stay a small
      // fraction of it, because neither path waits on it at all. holdMs is large
      // enough that ordinary CI scheduling noise on the (never-waited-on) route
      // handler itself cannot approach the threshold — only an actual wait on the
      // transport could.
      const holdMs = 4000
      mockSendEmail.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, holdMs)))

      const knownStart = Date.now()
      await postJson(requestPath, { email: knownEmail, tenantId })
      const knownDurationMs = Date.now() - knownStart

      const unknownStart = Date.now()
      await postJson(requestPath, { email: unknownEmail, tenantId })
      const unknownDurationMs = Date.now() - unknownStart

      expect(knownDurationMs).toBeLessThan(holdMs / 2)
      expect(unknownDurationMs).toBeLessThan(holdMs / 2)
    })

    it('redeems the delivered single-use link for a known account, and rejects a second redemption', async () => {
      mockSendEmail.mockResolvedValue(undefined)

      const res = await postJson(requestPath, { email: knownEmail, tenantId })
      expect(res.status).toBe(200)

      const result = await queue().process(workerHandler as any, { limit: 1 })
      expect(result.processed).toBe(1)
      expect(result.failed).toBe(0)

      expect(createSpy).toHaveBeenCalledTimes(1)
      const rawToken = await createSpy.mock.results[0]!.value
      expect(typeof rawToken).toBe('string')
      expect(mockSendEmail).toHaveBeenCalledTimes(1)

      const firstRedemption = await verify(rawToken)
      expect(firstRedemption).toEqual({ userId: knownUserId, tenantId })

      const secondRedemption = await verify(rawToken)
      expect(secondRedemption).toBeNull()

      await new Promise((resolve) => setImmediate(resolve))
      expect(mockEmit).toHaveBeenCalledWith(eventId, expect.objectContaining({ userId: knownUserId, tenantId }))
    })

    it('silently drops an unknown account without minting or sending anything', async () => {
      mockSendEmail.mockResolvedValue(undefined)

      const res = await postJson(requestPath, { email: unknownEmail, tenantId })
      expect(res.status).toBe(200)

      const result = await queue().process(workerHandler as any, { limit: 1 })
      expect(result.processed).toBe(1)
      expect(result.failed).toBe(0)
      expect(createSpy).not.toHaveBeenCalled()
      expect(mockSendEmail).not.toHaveBeenCalled()
    })

    it('retries delivery after a transport failure — surviving a simulated worker restart — then delivers a redeemable link', async () => {
      mockSendEmail.mockRejectedValueOnce(new Error('transport blocked'))

      const res = await postJson(requestPath, { email: knownEmail, tenantId })
      expect(res.status).toBe(200)

      const firstAttempt = await queue().process(workerHandler as any, { limit: 1 })
      expect(firstAttempt.processed).toBe(0)
      expect(firstAttempt.failed).toBe(1)
      // One call from the worker's own catch-and-rethrow, one from the queue
      // strategy's own retry logging around it.
      expect(mockLoggerError).toHaveBeenCalledTimes(2)
      expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ code: failureCode }))

      // The job is now in the local strategy's exponential-backoff window, not
      // immediately re-processable — exactly the state a worker restart would
      // observe: the job survives the process boundary on disk and is picked up
      // again once it becomes available, not re-created or lost.
      const duringBackoff = await queue().process(workerHandler as any, { limit: 1 })
      expect(duringBackoff.processed).toBe(0)
      expect(duringBackoff.failed).toBe(0)

      await new Promise((resolve) => setTimeout(resolve, 1200))

      mockSendEmail.mockResolvedValue(undefined)
      const retryAttempt = await queue().process(workerHandler as any, { limit: 1 })
      expect(retryAttempt.processed).toBe(1)
      expect(retryAttempt.failed).toBe(0)

      // Each attempt re-runs the handler from scratch, so the retry mints its
      // own fresh token rather than reusing the one from the failed attempt.
      expect(createSpy).toHaveBeenCalledTimes(2)
      const rawToken = await createSpy.mock.results[1]!.value
      const redemption = await verify(rawToken)
      expect(redemption).toEqual({ userId: knownUserId, tenantId })
    }, 15000)
  })
})
