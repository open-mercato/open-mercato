import { randomUUID } from 'node:crypto'
import { UniqueConstraintViolationException } from '@mikro-orm/core'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { setGlobalEventBus } from '@open-mercato/shared/modules/events'
import {
  clearGatewayAdapters,
  registerGatewayAdapter,
  type CreateSessionInput,
  type GatewayAdapter,
} from '@open-mercato/shared/modules/payment_gateways/types'
import { createPaymentGatewayService } from '../gateway-service'
import { buildPaymentSessionOperationKey } from '../session-idempotency'

const mockLoggerWarn = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({
    child: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: (...args: unknown[]) => mockLoggerWarn(...args),
      error: jest.fn(),
    }),
  }),
}))

type AnyRecord = Record<string, any>

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const PAYMENT_ID = '33333333-3333-4333-8333-333333333333'
const PROVIDER_KEY = 'barrier-gateway'

function claimKey(record: AnyRecord): string {
  return [record.organizationId, record.tenantId, record.providerKey, record.operationKey].join(':')
}

function isClaim(record: AnyRecord): boolean {
  return typeof record.operationKey === 'string' && 'claimToken' in record
}

function matches(record: AnyRecord, where: AnyRecord): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === '$or') {
      return (expected as AnyRecord[]).some((branch) => matches(record, branch))
    }
    if (expected && typeof expected === 'object' && '$lt' in expected) {
      const actual = record[key]
      return actual instanceof Date && actual < (expected as { $lt: Date }).$lt
    }
    return record[key] === expected
  })
}

function makeMockEm() {
  const claims = new Map<string, AnyRecord>()
  const transactions = new Map<string, AnyRecord>()
  const em: AnyRecord = {
    _claims: claims,
    _transactions: transactions,
    fork: () => em,
    create(cls: { name?: string }, data: AnyRecord) {
      return { id: randomUUID(), __entity: cls.name, ...data }
    },
    persist(entity: AnyRecord) {
      return { flush: async () => em._flushOne(entity) }
    },
    async flush() {},
    async transactional(callback: (tx: AnyRecord) => Promise<unknown>) {
      return callback(em)
    },
    async nativeUpdate(_cls: unknown, where: AnyRecord, data: AnyRecord) {
      for (const claim of claims.values()) {
        if (!matches(claim, where)) continue
        Object.assign(claim, data)
        return 1
      }
      return 0
    },
    async _flushOne(entity: AnyRecord) {
      if (isClaim(entity)) {
        const key = claimKey(entity)
        if (claims.has(key)) {
          throw new UniqueConstraintViolationException(new Error('duplicate payment-session claim'))
        }
        claims.set(key, entity)
        return
      }
      transactions.set(entity.id as string, entity)
    },
  }
  return em
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function buildInput(idempotencyKey: string) {
  return {
    providerKey: PROVIDER_KEY,
    paymentId: PAYMENT_ID,
    amount: 25,
    currencyCode: 'USD',
    idempotencyKey,
    organizationId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
  }
}

function buildService() {
  const em = makeMockEm()
  const gate = deferred()
  const firstCallStarted = deferred()
  let callSequence = 0
  const createSession = jest.fn(async (input: CreateSessionInput) => {
    callSequence += 1
    const callNumber = callSequence
    firstCallStarted.resolve()
    await gate.promise
    return {
      sessionId: `provider-session-${callNumber}`,
      clientSecret: `secret-${callNumber}`,
      status: 'pending' as const,
      providerData: { callNumber, operationKey: (input as CreateSessionInput & { idempotencyKey?: string }).idempotencyKey },
    }
  })
  const adapter = {
    providerKey: PROVIDER_KEY,
    createSession,
  } as unknown as GatewayAdapter
  registerGatewayAdapter(adapter)

  ;(findOneWithDecryption as jest.Mock).mockImplementation(
    async (_em: unknown, entity: { name?: string }, where: AnyRecord) => {
      const source = entity.name === 'GatewaySessionInitialization'
        ? em._claims.values()
        : em._transactions.values()
      for (const record of source) {
        if (matches(record, where)) return record
      }
      return null
    },
  )

  const service = createPaymentGatewayService({
    em,
    integrationCredentialsService: { resolve: jest.fn(async () => ({})) } as never,
    sessionClaimOptions: {
      staleAfterMs: 400,
      heartbeatIntervalMs: 10,
      pollIntervalMs: 2,
    },
  })
  return { service, em, gate, firstCallStarted, createSession }
}

describe('payment gateway service session idempotency (#4035)', () => {
  beforeAll(() => {
    setGlobalEventBus({ emit: async () => {} })
  })

  beforeEach(() => {
    clearGatewayAdapters()
    ;(findOneWithDecryption as jest.Mock).mockReset()
    mockLoggerWarn.mockReset()
  })

  afterEach(() => {
    clearGatewayAdapters()
  })

  it('maps a missing gateway adapter to a typed 422 error', async () => {
    const service = createPaymentGatewayService({
      em: makeMockEm(),
      integrationCredentialsService: { resolve: jest.fn(async () => ({})) } as never,
    })

    await expect(service.createPaymentSession(buildInput('checkout-submit-key-0000'))).rejects.toMatchObject({
      status: 422,
      body: { error: `No gateway adapter registered for provider: ${PROVIDER_KEY}` },
    })
  })

  it('single-flights concurrent keyed calls and reuses the completed provider session', async () => {
    const { service, gate, firstCallStarted, createSession } = buildService()
    const input = buildInput('checkout-submit-key-0001')

    const first = service.createPaymentSession(input)
    const second = service.createPaymentSession(input)
    await firstCallStarted.promise
    await new Promise((resolve) => setTimeout(resolve, 80))
    const callsWhileBlocked = createSession.mock.calls.length
    gate.resolve()

    const [firstResult, secondResult] = await Promise.all([first, second])
    const replay = await service.createPaymentSession(input)

    expect(callsWhileBlocked).toBe(1)
    expect(createSession).toHaveBeenCalledTimes(1)
    expect(firstResult.transaction.id).toBe(secondResult.transaction.id)
    expect(firstResult.session.sessionId).toBe(secondResult.session.sessionId)
    expect(replay.transaction.id).toBe(firstResult.transaction.id)
    expect(replay.session.sessionId).toBe(firstResult.session.sessionId)
    expect(createSession.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      idempotencyKey: expect.stringMatching(/^om-payment-session:/),
    }))
  })

  it('reclaims a stale claim left by a crashed owner', async () => {
    const { service, em, gate, createSession } = buildService()
    const input = buildInput('checkout-submit-key-0002')
    const operationKey = buildPaymentSessionOperationKey({
      idempotencyKey: input.idempotencyKey,
      paymentId: input.paymentId,
      providerKey: input.providerKey,
      scope: { organizationId: input.organizationId, tenantId: input.tenantId },
    })
    const staleClaim = {
      id: randomUUID(),
      operationKey,
      providerKey: input.providerKey,
      claimToken: randomUUID(),
      claimedAt: new Date(0),
      gatewayTransactionId: null,
      organizationId: input.organizationId,
      tenantId: input.tenantId,
    }
    em._claims.set(claimKey(staleClaim), staleClaim)
    gate.resolve()
    const recoveryResult = await service.createPaymentSession(input)

    expect(createSession).toHaveBeenCalledTimes(1)
    expect(createSession.mock.calls[0]?.[0].idempotencyKey).toBe(operationKey)
    expect(recoveryResult.session.sessionId).toBe('provider-session-1')
    expect(em._transactions.size).toBe(1)
  })

  it('warns when claim release fails and rethrows the original provider error', async () => {
    const { service, em, createSession } = buildService()
    const providerError = new Error('provider unavailable')
    const releaseError = new Error('claim release failed')
    const originalNativeUpdate = em.nativeUpdate.bind(em)
    createSession.mockRejectedValueOnce(providerError)
    em.nativeUpdate = async (cls: unknown, where: AnyRecord, data: AnyRecord) => {
      const isClaimRelease = data.claimToken === null && data.claimedAt === null
      if (isClaimRelease) throw releaseError
      return originalNativeUpdate(cls, where, data)
    }

    await expect(service.createPaymentSession(buildInput('checkout-submit-key-0006'))).rejects.toBe(providerError)
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Failed to release payment session initialization claim',
      expect.objectContaining({
        claimId: expect.any(String),
        providerKey: PROVIDER_KEY,
        err: releaseError,
      }),
    )
  })

  it('marks the missing completed-session transaction invariant as internal', async () => {
    const { service, em } = buildService()
    const input = buildInput('checkout-submit-key-0007')
    const operationKey = buildPaymentSessionOperationKey({
      idempotencyKey: input.idempotencyKey,
      paymentId: input.paymentId,
      providerKey: input.providerKey,
      scope: { organizationId: input.organizationId, tenantId: input.tenantId },
    })
    const completedClaim = {
      id: randomUUID(),
      operationKey,
      providerKey: input.providerKey,
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      gatewayTransactionId: randomUUID(),
      claimToken: null,
    }
    em._claims.set(claimKey(completedClaim), completedClaim)

    await expect(service.createPaymentSession(input)).rejects.toThrow(
      '[internal] Completed payment session is missing its gateway transaction',
    )
  })

  it('survives a heartbeat refresh failure during the provider call without rejecting', async () => {
    const { service, em, gate, firstCallStarted, createSession } = buildService()
    const input = buildInput('checkout-submit-key-0005')
    const originalNativeUpdate = em.nativeUpdate.bind(em)
    let refreshFailures = 0
    em.nativeUpdate = async (cls: unknown, where: AnyRecord, data: AnyRecord) => {
      const isHeartbeatRefresh = 'claimToken' in where && 'claimedAt' in data && !('claimToken' in data)
      if (isHeartbeatRefresh && refreshFailures === 0) {
        refreshFailures += 1
        throw new Error('transient database outage')
      }
      return originalNativeUpdate(cls, where, data)
    }

    const pending = service.createPaymentSession(input)
    await firstCallStarted.promise
    await new Promise((resolve) => setTimeout(resolve, 50))
    gate.resolve()

    const result = await pending
    expect(refreshFailures).toBe(1)
    expect(createSession).toHaveBeenCalledTimes(1)
    expect(result.session.sessionId).toBe('provider-session-1')
    expect(em._transactions.size).toBe(1)
  })

  it('keeps different checkout idempotency keys independent', async () => {
    const { service, gate, createSession } = buildService()
    gate.resolve()

    const [first, second] = await Promise.all([
      service.createPaymentSession(buildInput('checkout-submit-key-0003')),
      service.createPaymentSession(buildInput('checkout-submit-key-0004')),
    ])

    expect(createSession).toHaveBeenCalledTimes(2)
    expect(first.transaction.id).not.toBe(second.transaction.id)
    expect(first.session.sessionId).not.toBe(second.session.sessionId)
    expect(createSession.mock.calls[0]?.[0].idempotencyKey).not.toBe(
      createSession.mock.calls[1]?.[0].idempotencyKey,
    )
  })
})
