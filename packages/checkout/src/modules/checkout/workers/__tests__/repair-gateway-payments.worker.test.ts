// #8268 review Medium 7: `recordGatewayPayment`'s own 3 immediate in-process retries
// (`commands/submit.ts`) can all fail, permanently leaving a paid order with no
// `SalesPayment` since nothing else ever retries it. This worker re-derives the exact same
// `GatewayPaymentRecord` straight from the durable `CheckoutTransaction` row and calls
// `recordGatewayPayment` again — these tests prove it targets the right rows and is a
// no-op once a payment is already recorded.

import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { JobContext, QueuedJob } from '@open-mercato/queue'
import { CheckoutSession, CheckoutTransaction } from '../../data/entities'
import type { RepairGatewayPaymentsJob } from '../repair-gateway-payments.worker'

const mockRecordGatewayPayment = jest.fn(async () => undefined)
jest.mock('../../commands/submit', () => ({
  recordGatewayPayment: (...args: unknown[]) => mockRecordGatewayPayment(...args),
}))

const TENANT_ID = 'tenant-repair-1'
const ORG_ID = 'org-repair-1'

function makeTransaction(overrides: Partial<CheckoutTransaction> = {}): CheckoutTransaction {
  return {
    id: 'checkout-txn-repair-1',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    sessionId: 'session-repair-1',
    orderId: 'order-repair-1',
    status: 'completed',
    amount: '42.00',
    currencyCode: 'USD',
    gatewayTransactionId: 'gw-ref-1',
    paymentStatus: 'captured',
    ...overrides,
  } as CheckoutTransaction
}

describe('checkout repair-gateway-payments worker', () => {
  beforeEach(() => {
    mockRecordGatewayPayment.mockClear()
    mockRecordGatewayPayment.mockImplementation(async () => undefined)
  })

  function buildEm(options: {
    transactions: CheckoutTransaction[]
    session?: CheckoutSession | null
    recordedPayments?: Array<{ order_id: string; payment_reference: string | null; captured_amount: string }>
  }) {
    const findMock = jest.fn(async () => options.transactions)
    const findOneMock = jest.fn(async () => (
      options.session !== undefined ? options.session : ({ id: 'session-repair-1', tenantId: TENANT_ID, organizationId: ORG_ID } as CheckoutSession)
    ))
    const recordedPayments = options.recordedPayments ?? []
    const kyselyExecuteMock = jest.fn(async () => recordedPayments)
    const builder: Record<string, unknown> = {
      selectFrom: () => builder,
      select: () => builder,
      where: () => builder,
      execute: () => kyselyExecuteMock(),
    }
    const em = {
      fork: () => em,
      find: (...args: unknown[]) => findMock(...args),
      findOne: (...args: unknown[]) => findOneMock(...args),
      getKysely: () => builder,
    }
    return { em, findMock, findOneMock, kyselyExecuteMock }
  }

  // #8268 review Major 6 (re-review): `buildEm` above always returns its whole fixture
  // array regardless of the query, which is enough for the single-page tests but cannot
  // exercise keyset pagination. This builds a small in-memory stand-in for the real
  // `updatedAt >= cutoff` + `(updatedAt, id)` cursor query the worker now issues, so these
  // tests prove the ACTUAL page-advancing behavior rather than asserting against a mock
  // that could never fail to advance.
  function buildPaginatedEm(options: {
    transactions: CheckoutTransaction[]
    recordedPayments?: Array<{ order_id: string; payment_reference: string | null; captured_amount: string }>
  }) {
    const recordedPayments = options.recordedPayments ?? []
    const findMock = jest.fn(async (_entity: unknown, where: any, queryOptions: any) => {
      const cutoff = where.updatedAt?.$gte as Date
      let rows = options.transactions.filter((t) => (t.updatedAt as Date) >= cutoff)
      if (where.$or) {
        const [afterClause, tieClause] = where.$or as Array<Record<string, any>>
        const cursorUpdatedAt = afterClause.updatedAt.$gt as Date
        const cursorId = tieClause.id.$gt as string
        rows = rows.filter((t) => {
          const u = t.updatedAt as Date
          if (u.getTime() > cursorUpdatedAt.getTime()) return true
          return u.getTime() === cursorUpdatedAt.getTime() && (t.id as string) > cursorId
        })
      }
      rows = [...rows].sort((a, b) => {
        const diff = (a.updatedAt as Date).getTime() - (b.updatedAt as Date).getTime()
        if (diff !== 0) return diff
        return (a.id as string) < (b.id as string) ? -1 : 1
      })
      const limit = queryOptions?.limit as number | undefined
      return typeof limit === 'number' ? rows.slice(0, limit) : rows
    })
    const findOneMock = jest.fn(async () => ({ id: 'session-repair-1', tenantId: TENANT_ID, organizationId: ORG_ID } as CheckoutSession))
    const kyselyExecuteMock = jest.fn(async () => recordedPayments)
    const builder: Record<string, unknown> = {
      selectFrom: () => builder,
      select: () => builder,
      where: () => builder,
      execute: () => kyselyExecuteMock(),
    }
    const em = {
      fork: () => em,
      find: (...args: unknown[]) => findMock(...args),
      findOne: (...args: unknown[]) => findOneMock(...args),
      getKysely: () => builder,
    }
    return { em, findMock, kyselyExecuteMock, recordedPayments }
  }

  function buildCtx(em: unknown): JobContext & { resolve: <T = unknown>(name: string) => T } {
    return {
      resolve: <T = unknown>(name: string): T => {
        if (name === 'em') return em as T
        throw new Error(`[internal] Missing dependency: ${name}`)
      },
    } as unknown as JobContext & { resolve: <T = unknown>(name: string) => T }
  }

  function buildJob(payload: RepairGatewayPaymentsJob): QueuedJob<RepairGatewayPaymentsJob> {
    return { payload } as QueuedJob<RepairGatewayPaymentsJob>
  }

  it('retries recordGatewayPayment for a completed session-backed transaction, deriving the record from the transaction row', async () => {
    const transaction = makeTransaction()
    const { em } = buildEm({ transactions: [transaction] })
    const { default: handle } = await import('../repair-gateway-payments.worker')

    await handle(buildJob({ tenantId: TENANT_ID, organizationId: ORG_ID }), buildCtx(em))

    expect(mockRecordGatewayPayment).toHaveBeenCalledTimes(1)
    const [, , , , orderId, gatewayPayment] = mockRecordGatewayPayment.mock.calls[0]
    expect(orderId).toBe('order-repair-1')
    expect(gatewayPayment).toMatchObject({ amount: '42.00', currencyCode: 'USD', paymentReference: 'gw-ref-1', captured: true })
  })

  it('derives captured: false for a still-authorized (not yet captured) transaction', async () => {
    const transaction = makeTransaction({ paymentStatus: 'authorized' })
    const { em } = buildEm({ transactions: [transaction] })
    const { default: handle } = await import('../repair-gateway-payments.worker')

    await handle(buildJob({ tenantId: TENANT_ID, organizationId: ORG_ID }), buildCtx(em))

    const [, , , , , gatewayPayment] = mockRecordGatewayPayment.mock.calls[0]
    expect(gatewayPayment).toMatchObject({ captured: false })
  })

  it('skips a transaction with no linked order or session', async () => {
    const transaction = makeTransaction({ orderId: null })
    const { em } = buildEm({ transactions: [transaction] })
    const { default: handle } = await import('../repair-gateway-payments.worker')

    await handle(buildJob({ tenantId: TENANT_ID, organizationId: ORG_ID }), buildCtx(em))

    expect(mockRecordGatewayPayment).not.toHaveBeenCalled()
  })

  it('skips a transaction whose session can no longer be found', async () => {
    const transaction = makeTransaction()
    const { em } = buildEm({ transactions: [transaction], session: null })
    const { default: handle } = await import('../repair-gateway-payments.worker')

    await handle(buildJob({ tenantId: TENANT_ID, organizationId: ORG_ID }), buildCtx(em))

    expect(mockRecordGatewayPayment).not.toHaveBeenCalled()
  })

  it('continues the batch when one transaction repair throws', async () => {
    mockRecordGatewayPayment
      .mockImplementationOnce(async () => { throw new Error('boom') })
      .mockImplementationOnce(async () => undefined)
    const { em } = buildEm({ transactions: [makeTransaction({ id: 'txn-a' }), makeTransaction({ id: 'txn-b' })] })
    const { default: handle } = await import('../repair-gateway-payments.worker')

    await expect(handle(buildJob({ tenantId: TENANT_ID, organizationId: ORG_ID }), buildCtx(em))).resolves.toBeUndefined()

    expect(mockRecordGatewayPayment).toHaveBeenCalledTimes(2)
  })

  it('#8268 review Major 4: does not let an already-recorded transaction occupy a batch slot a genuinely outstanding one needs', async () => {
    // One already-recorded (captured) transaction, oldest by `updatedAt`, plus one still
    // outstanding transaction. With a `batchSize` of 1, the old starvation shape would
    // select only the already-recorded row (a no-op) and never reach the outstanding one.
    const recorded = makeTransaction({ id: 'txn-recorded', orderId: 'order-recorded', gatewayTransactionId: 'gw-recorded' })
    const outstanding = makeTransaction({ id: 'txn-outstanding', orderId: 'order-outstanding', gatewayTransactionId: 'gw-outstanding' })
    const { em } = buildEm({
      transactions: [recorded, outstanding],
      recordedPayments: [{ order_id: 'order-recorded', payment_reference: 'gw-recorded', captured_amount: '42.00' }],
    })
    const { default: handle } = await import('../repair-gateway-payments.worker')

    await handle(buildJob({ tenantId: TENANT_ID, organizationId: ORG_ID, batchSize: 1 }), buildCtx(em))

    expect(mockRecordGatewayPayment).toHaveBeenCalledTimes(1)
    const [, , , , orderId] = mockRecordGatewayPayment.mock.calls[0]
    expect(orderId).toBe('order-outstanding')
  })

  it('requires tenantId and organizationId in the job payload', async () => {
    const { em } = buildEm({ transactions: [] })
    const { default: handle } = await import('../repair-gateway-payments.worker')

    await expect(handle(buildJob({} as RepairGatewayPaymentsJob), buildCtx(em))).rejects.toThrow(
      '[internal] tenantId and organizationId are required in RepairGatewayPaymentsJob',
    )
  })

  it('#8268 review Major 6 (re-review): keyset-pages across multiple database round trips instead of loading the whole window at once', async () => {
    const now = Date.now()
    // 250 outstanding transactions > the worker's 200-row page size, oldest first, so a
    // single page alone cannot satisfy this run's batchSize of 250 — a second `em.find`
    // call, advanced past the first page's cursor, is required to reach them all.
    const transactions = Array.from({ length: 250 }, (_, index) => makeTransaction({
      id: `txn-${String(index).padStart(3, '0')}`,
      orderId: `order-${String(index).padStart(3, '0')}`,
      gatewayTransactionId: `gw-${String(index).padStart(3, '0')}`,
      updatedAt: new Date(now - (250 - index) * 60 * 1000),
    }))
    const { em, findMock } = buildPaginatedEm({ transactions })
    const { default: handle } = await import('../repair-gateway-payments.worker')

    await handle(buildJob({ tenantId: TENANT_ID, organizationId: ORG_ID, batchSize: 250 }), buildCtx(em))

    expect(findMock.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(mockRecordGatewayPayment).toHaveBeenCalledTimes(250)
    // Oldest-first: the very first and very last repair calls must be the window's actual
    // oldest and newest candidates, proving the cursor advanced through every one exactly
    // once rather than skipping or re-fetching the first page's rows.
    expect(mockRecordGatewayPayment.mock.calls[0][4]).toBe('order-000')
    expect(mockRecordGatewayPayment.mock.calls[249][4]).toBe('order-249')
  })

  it('#8268 review Major 6 (re-review): a repeated sweep does not re-repair a transaction the previous sweep already recorded', async () => {
    const transaction = makeTransaction({
      id: 'txn-repeat',
      orderId: 'order-repeat',
      gatewayTransactionId: 'gw-repeat',
      updatedAt: new Date(Date.now() - 60 * 60 * 1000),
    })
    const recordedPayments: Array<{ order_id: string; payment_reference: string | null; captured_amount: string }> = []
    mockRecordGatewayPayment.mockImplementation(async () => {
      recordedPayments.push({ order_id: 'order-repeat', payment_reference: 'gw-repeat', captured_amount: '42.00' })
    })
    const { em } = buildPaginatedEm({ transactions: [transaction], recordedPayments })
    const { default: handle } = await import('../repair-gateway-payments.worker')

    await handle(buildJob({ tenantId: TENANT_ID, organizationId: ORG_ID }), buildCtx(em))
    expect(mockRecordGatewayPayment).toHaveBeenCalledTimes(1)

    await handle(buildJob({ tenantId: TENANT_ID, organizationId: ORG_ID }), buildCtx(em))
    expect(mockRecordGatewayPayment).toHaveBeenCalledTimes(1)
  })

  it('#8268 review Major 6 (re-review): excludes a transaction whose updatedAt already left the 48-hour lookback window', async () => {
    const now = Date.now()
    const agedOut = makeTransaction({
      id: 'txn-aged-out',
      orderId: 'order-aged-out',
      gatewayTransactionId: 'gw-aged-out',
      updatedAt: new Date(now - 49 * 60 * 60 * 1000),
    })
    const stillInWindow = makeTransaction({
      id: 'txn-in-window',
      orderId: 'order-in-window',
      gatewayTransactionId: 'gw-in-window',
      updatedAt: new Date(now - 1 * 60 * 60 * 1000),
    })
    const { em } = buildPaginatedEm({ transactions: [agedOut, stillInWindow] })
    const { default: handle } = await import('../repair-gateway-payments.worker')

    await handle(buildJob({ tenantId: TENANT_ID, organizationId: ORG_ID }), buildCtx(em))

    expect(mockRecordGatewayPayment).toHaveBeenCalledTimes(1)
    expect(mockRecordGatewayPayment.mock.calls[0][4]).toBe('order-in-window')
  })
})
