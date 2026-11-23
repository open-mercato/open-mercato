import { QueryOrder } from '@mikro-orm/core'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { setGlobalEventBus } from '@open-mercato/shared/modules/events'
import {
  registerGatewayAdapter,
  clearGatewayAdapters,
  type GatewayAdapter,
  type UnifiedPaymentStatus,
} from '@open-mercato/shared/modules/payment_gateways/types'
import type { GatewayTransaction } from '../../data/entities'
import { createPaymentGatewayService } from '../gateway-service'
import handleStatusPoll from '../../workers/status-poller'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

const findOneMock = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>
const findManyMock = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>

const PROVIDER_KEY = 'mock-poller'
const OPEN_STATUSES = ['pending', 'authorized', 'partially_captured']

type StoredTransaction = {
  id: string
  paymentId: string
  providerKey: string
  providerSessionId: string
  unifiedStatus: UnifiedPaymentStatus
  amount: string
  capturedAmount: string
  gatewayMetadata: Record<string, unknown>
  organizationId: string
  tenantId: string
  createdAt: Date
  updatedAt: Date
  lastPolledAt: Date | null
  deletedAt: Date | null
}

type OrderBy = Record<string, string>

function compareByOrder(left: StoredTransaction, right: StoredTransaction, orderBy: OrderBy): number {
  for (const [field, direction] of Object.entries(orderBy)) {
    const normalized = direction.toUpperCase()
    const leftValue = left[field as keyof StoredTransaction] as Date | null
    const rightValue = right[field as keyof StoredTransaction] as Date | null
    if (leftValue === rightValue) continue
    if (leftValue === null || rightValue === null) {
      const nullsFirst = normalized.includes('NULLS FIRST') || (normalized.startsWith('DESC') && !normalized.includes('NULLS LAST'))
      const leftIsNull = leftValue === null
      return leftIsNull === nullsFirst ? -1 : 1
    }
    const delta = leftValue.getTime() - rightValue.getTime()
    if (delta === 0) continue
    return normalized.startsWith('DESC') ? -delta : delta
  }
  return 0
}

function buildStore(count: number): StoredTransaction[] {
  const base = Date.UTC(2026, 0, 1)
  return Array.from({ length: count }, (_, index) => ({
    id: `txn_${index + 1}`,
    paymentId: `pay_${index + 1}`,
    providerKey: PROVIDER_KEY,
    providerSessionId: `sess_${index + 1}`,
    unifiedStatus: 'pending' as UnifiedPaymentStatus,
    amount: '100.0000',
    capturedAmount: '0.0000',
    gatewayMetadata: {},
    organizationId: 'org_1',
    tenantId: 'tenant_1',
    createdAt: new Date(base + index * 60_000),
    updatedAt: new Date(base + index * 60_000),
    lastPolledAt: null,
    deletedAt: null,
  }))
}

function buildService(store: StoredTransaction[], statusFor: (sessionId: string) => UnifiedPaymentStatus) {
  const getStatus = jest.fn(async ({ sessionId }: { sessionId: string }) => ({ status: statusFor(sessionId) }))
  registerGatewayAdapter({
    providerKey: PROVIDER_KEY,
    createSession: jest.fn(),
    capture: jest.fn(),
    refund: jest.fn(),
    cancel: jest.fn(),
    getStatus,
    verifyWebhook: jest.fn(),
    mapStatus: jest.fn(() => 'unknown' as UnifiedPaymentStatus),
  } as unknown as GatewayAdapter)

  const flush = jest.fn(async () => {
    for (const record of store) record.updatedAt = new Date()
  })
  const nativeUpdate = jest.fn(async (_entity: unknown, where: Record<string, unknown>, update: Record<string, unknown>) => {
    const matched = store.find((record) => (
      record.id === where.id && record.organizationId === where.organizationId && record.tenantId === where.tenantId
    ))
    if (!matched) return 0
    Object.assign(matched, update)
    return 1
  })
  const em: Record<string, unknown> = { flush, nativeUpdate }
  em.fork = jest.fn(() => em)
  em.transactional = jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(em))

  findOneMock.mockImplementation(async (_em, _entity, where) => {
    const criteria = where as { id?: string; organizationId?: string; tenantId?: string }
    return (store.find((record) => (
      record.id === criteria.id
      && record.organizationId === criteria.organizationId
      && record.tenantId === criteria.tenantId
      && record.deletedAt === null
    )) ?? null) as never
  })
  findManyMock.mockImplementation(async (_em, _entity, where, options) => {
    const criteria = where as { unifiedStatus: { $in: string[] }; organizationId?: string; tenantId?: string; providerKey?: string }
    const findOptions = (options ?? {}) as { orderBy?: OrderBy; limit?: number }
    const eligible = store.filter((record) => (
      criteria.unifiedStatus.$in.includes(record.unifiedStatus)
      && record.deletedAt === null
      && (!criteria.organizationId || record.organizationId === criteria.organizationId)
      && (!criteria.tenantId || record.tenantId === criteria.tenantId)
      && (!criteria.providerKey || record.providerKey === criteria.providerKey)
    ))
    const sorted = [...eligible].sort((left, right) => compareByOrder(left, right, findOptions.orderBy ?? {}))
    return sorted.slice(0, findOptions.limit ?? sorted.length) as never
  })

  const service = createPaymentGatewayService({
    em: em as never,
    integrationCredentialsService: { resolve: jest.fn(async () => ({})) } as never,
  })
  return { service, getStatus, flush, nativeUpdate }
}

async function runPoller(service: ReturnType<typeof createPaymentGatewayService>, limit: number) {
  const integrationLogService = { write: jest.fn(async () => {}) }
  const ctx = {
    resolve: (name: string) => (name === 'paymentGatewayService' ? service : integrationLogService),
  }
  await handleStatusPoll({ payload: { limit } } as never, ctx as never)
  return integrationLogService
}

describe('payment gateway service — status polling rotation', () => {
  const emit = jest.fn(async () => {})

  beforeAll(() => {
    setGlobalEventBus({ emit })
  })

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-02-01T00:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate'] })
    clearGatewayAdapters()
    findOneMock.mockReset()
    findManyMock.mockReset()
    emit.mockClear()
  })

  afterEach(() => {
    jest.useRealTimers()
    clearGatewayAdapters()
  })

  it('selects open transactions by least recently polled first, never-polled before polled, then oldest', async () => {
    const store = buildStore(1)
    const { service } = buildService(store, () => 'pending')

    await service.listTransactionsForStatusPolling({ organizationId: 'org_1', tenantId: 'tenant_1', providerKey: PROVIDER_KEY })

    expect(findManyMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        unifiedStatus: { $in: OPEN_STATUSES },
        deletedAt: null,
        organizationId: 'org_1',
        tenantId: 'tenant_1',
        providerKey: PROVIDER_KEY,
      },
      { orderBy: { lastPolledAt: QueryOrder.ASC_NULLS_FIRST, createdAt: QueryOrder.ASC }, limit: 100 },
      expect.anything(),
    )
  })

  it('stamps only lastPolledAt when the provider reports no status change', async () => {
    const store = buildStore(1)
    const originalUpdatedAt = store[0].updatedAt
    const { service, flush, nativeUpdate } = buildService(store, () => 'pending')

    await service.getPaymentStatus('txn_1', { organizationId: 'org_1', tenantId: 'tenant_1' })

    expect(nativeUpdate).toHaveBeenCalledTimes(1)
    expect(nativeUpdate).toHaveBeenCalledWith(
      expect.anything(),
      { id: 'txn_1', organizationId: 'org_1', tenantId: 'tenant_1' },
      { lastPolledAt: new Date('2026-02-01T00:00:00.000Z') },
    )
    expect(flush).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
    expect(store[0].unifiedStatus).toBe('pending')
    expect(store[0].updatedAt).toBe(originalUpdatedAt)
    expect(store[0].lastPolledAt).toEqual(new Date('2026-02-01T00:00:00.000Z'))
  })

  it('keeps applying a status transition through the unit of work', async () => {
    const store = buildStore(1)
    const { service, flush, nativeUpdate } = buildService(store, () => 'authorized')

    await service.getPaymentStatus('txn_1', { organizationId: 'org_1', tenantId: 'tenant_1' })

    expect(store[0].unifiedStatus).toBe('authorized')
    expect(store[0].lastPolledAt).toEqual(new Date('2026-02-01T00:00:00.000Z'))
    expect(flush).toHaveBeenCalledTimes(1)
    expect(nativeUpdate).not.toHaveBeenCalled()
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0][0]).toBe('payment_gateways.payment.authorized')
  })

  it('rotates through a backlog of unchanged transactions larger than the limit across runs', async () => {
    const store = buildStore(5)
    const { service, getStatus } = buildService(store, () => 'pending')
    const polledPerRun: string[][] = []

    for (let run = 0; run < 3; run += 1) {
      getStatus.mockClear()
      jest.advanceTimersByTime(60_000)
      await runPoller(service, 2)
      polledPerRun.push(getStatus.mock.calls.map(([input]) => input.sessionId))
    }

    expect(polledPerRun).toEqual([
      ['sess_1', 'sess_2'],
      ['sess_3', 'sess_4'],
      ['sess_5', 'sess_1'],
    ])
    expect(store.every((record) => record.lastPolledAt !== null)).toBe(true)
  })

  it('reaches a newer transaction that settled while older ones stay unchanged', async () => {
    const store = buildStore(4)
    const { service } = buildService(store, (sessionId) => (sessionId === 'sess_4' ? 'captured' : 'pending'))

    for (let run = 0; run < 2; run += 1) {
      jest.advanceTimersByTime(60_000)
      await runPoller(service, 2)
    }

    expect(store.find((record) => record.id === 'txn_4')?.unifiedStatus).toBe('captured')
  })

  it('stamps lastPolledAt on a failed provider call so a persistently failing transaction cannot block the queue', async () => {
    const store = buildStore(3)
    const { service, getStatus } = buildService(store, () => 'pending')
    getStatus.mockImplementation(async ({ sessionId }: { sessionId: string }) => {
      if (sessionId === 'sess_1') throw new Error('provider unavailable')
      return { status: 'pending' as UnifiedPaymentStatus }
    })
    const polledPerRun: string[][] = []
    let failuresLogged = 0

    for (let run = 0; run < 3; run += 1) {
      getStatus.mockClear()
      jest.advanceTimersByTime(60_000)
      const logService = await runPoller(service, 1)
      failuresLogged += logService.write.mock.calls.length
      polledPerRun.push(getStatus.mock.calls.map(([input]) => input.sessionId))
    }

    expect(polledPerRun).toEqual([['sess_1'], ['sess_2'], ['sess_3']])
    expect(failuresLogged).toBe(1)
    expect(store[0].lastPolledAt).not.toBeNull()
    expect(store[0].unifiedStatus).toBe('pending')
  })

  it('rethrows the provider error when recording the poll time after a failed read also fails', async () => {
    const store = buildStore(1)
    const { service, getStatus, nativeUpdate } = buildService(store, () => 'pending')
    const providerError = new Error('provider unavailable')
    getStatus.mockRejectedValueOnce(providerError)
    nativeUpdate.mockRejectedValueOnce(new Error('database unavailable'))

    await expect(
      service.getPaymentStatus('txn_1', { organizationId: 'org_1', tenantId: 'tenant_1' }),
    ).rejects.toBe(providerError)
    expect(nativeUpdate).toHaveBeenCalledTimes(1)
  })
})
