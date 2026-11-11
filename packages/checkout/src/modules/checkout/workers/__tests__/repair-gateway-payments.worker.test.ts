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

const mockLogger = { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn(), child: jest.fn() }
mockLogger.child.mockReturnValue(mockLogger)
jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => mockLogger,
}))

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
    // Recent by default so pre-existing fixtures land in the main scan window, not the
    // ancient safety-net scan — tests that care about the ancient path override this.
    updatedAt: new Date(),
    ...overrides,
  } as CheckoutTransaction
}

// Minimal in-memory stand-in for `ModuleConfigService` (`packages/core/src/modules/configs`)
// — the generic per-tenant key/value store the worker now uses to persist its scan cursor
// across runs. Scoped by `(moduleId, name, tenantId)` exactly like the real service.
function buildModuleConfigService() {
  const store = new Map<string, unknown>()
  const keyOf = (moduleId: string, name: string) => `${moduleId}:${name}`
  return {
    getValue: jest.fn(async (moduleId: string, name: string) => {
      const key = keyOf(moduleId, name)
      return store.has(key) ? store.get(key) : null
    }),
    setValue: jest.fn(async (moduleId: string, name: string, value: unknown) => {
      store.set(keyOf(moduleId, name), value)
      return null
    }),
    getRecord: jest.fn(async () => null),
    restoreDefaults: jest.fn(async () => undefined),
    invalidate: jest.fn(async () => undefined),
  }
}

describe('checkout repair-gateway-payments worker', () => {
  beforeEach(() => {
    mockRecordGatewayPayment.mockClear()
    mockRecordGatewayPayment.mockImplementation(async () => undefined)
    mockLogger.warn.mockClear()
    mockLogger.error.mockClear()
  })

  // `options.transactions` is still returned as-is for a plain (non-time-filtered) query,
  // but a query that carries the worker's own `updatedAt.$gte`/`updatedAt.$lt` window filter
  // is honored — this is what lets the ancient safety-net scan (`updatedAt < cutoff`) and
  // the main window scan (`updatedAt >= cutoff`) see DIFFERENT subsets of one fixture array
  // instead of the main-scan fixtures being double-counted through the ancient scan too.
  function buildEm(options: {
    transactions: CheckoutTransaction[]
    session?: CheckoutSession | null
    recordedPayments?: Array<{ order_id: string; payment_reference: string | null; captured_amount: string }>
  }) {
    const findMock = jest.fn(async (_entity: unknown, where: any) => {
      const updatedAtFilter = where?.updatedAt as { $gte?: Date; $lt?: Date } | undefined
      if (!updatedAtFilter) return options.transactions
      return options.transactions.filter((t) => {
        const updatedAt = (t.updatedAt as Date | undefined) ?? new Date()
        if (updatedAtFilter.$gte) return updatedAt.getTime() >= updatedAtFilter.$gte.getTime()
        if (updatedAtFilter.$lt) return updatedAt.getTime() < updatedAtFilter.$lt.getTime()
        return true
      })
    })
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
      const gte = where.updatedAt?.$gte as Date | undefined
      const lt = where.updatedAt?.$lt as Date | undefined
      let rows = options.transactions.filter((t) => {
        const updatedAt = t.updatedAt as Date
        if (gte) return updatedAt.getTime() >= gte.getTime()
        if (lt) return updatedAt.getTime() < lt.getTime()
        return true
      })
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

  function buildCtx(em: unknown, moduleConfigService?: unknown): JobContext & { resolve: <T = unknown>(name: string) => T } {
    return {
      resolve: <T = unknown>(name: string): T => {
        if (name === 'em') return em as T
        if (name === 'moduleConfigService' && moduleConfigService) return moduleConfigService as T
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

  it('finding fix: a transaction whose updatedAt already left the 48-hour lookback window is still reachable through the ancient safety-net scan, not silently and permanently dropped', async () => {
    // Before this fix, `updatedAt >= cutoff` was this worker's ONLY query — a still-broken
    // transaction older than 48h (e.g. from a multi-day outage) left that query forever and
    // nothing ever repaired it again. The ancient scan (`updatedAt < cutoff`) now exists
    // specifically to keep reaching it, prioritized ahead of the normal window so it is not
    // crowded out by recent, usually much larger, backlog.
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

    expect(mockRecordGatewayPayment).toHaveBeenCalledTimes(2)
    const repairedOrderIds = mockRecordGatewayPayment.mock.calls.map((call) => call[4])
    expect(repairedOrderIds).toContain('order-aged-out')
    expect(repairedOrderIds).toContain('order-in-window')
    // The permanent-loss risk is also surfaced loudly (not `debug`) so an operator has a
    // signal before anything becomes unreachable, independent of whether the safety-net
    // scan itself manages to clear the backlog this run.
    expect(mockLogger.warn).toHaveBeenCalledWith(
      '[internal] repair-gateway-payments: found transactions still outstanding after aging out of the lookback window',
      expect.objectContaining({ count: 1 }),
    )
  })

  it('finding fix: a repeated sweep behind a large backlog of already-correct rows eventually reaches and repairs an outstanding one in a later run by resuming from a persisted cursor', async () => {
    // Reproduces the starvation this finding describes at a scale the test can run
    // quickly: more already-correct rows than one run's page budget
    // (`REPAIR_MAX_PAGES * REPAIR_PAGE_SIZE` = 25 * 200 = 5000) can scan, oldest-first,
    // followed by a single genuinely outstanding row just past that budget. Before this
    // fix, `cursor` always restarted at `null`, so a second run would re-scan the exact
    // same first 5000 rows and NEVER reach row 5001 — this proves the cursor persists
    // across runs instead, so the second run resumes past where the first one stopped.
    const now = Date.now()
    const alreadyCorrectCount = 5000
    const alreadyCorrect = Array.from({ length: alreadyCorrectCount }, (_, index) => {
      const orderId = `order-correct-${index}`
      const gatewayTransactionId = `gw-correct-${index}`
      return {
        transaction: makeTransaction({
          id: `txn-correct-${index}`,
          orderId,
          gatewayTransactionId,
          updatedAt: new Date(now - (alreadyCorrectCount + 1 - index) * 1000),
        }),
        recorded: { order_id: orderId, payment_reference: gatewayTransactionId, captured_amount: '42.00' },
      }
    })
    const outstanding = makeTransaction({
      id: 'txn-beyond-first-run-budget',
      orderId: 'order-beyond-first-run-budget',
      gatewayTransactionId: 'gw-beyond-first-run-budget',
      updatedAt: new Date(now - 1000),
    })
    const { em, findMock } = buildPaginatedEm({
      transactions: [...alreadyCorrect.map((entry) => entry.transaction), outstanding],
      recordedPayments: alreadyCorrect.map((entry) => entry.recorded),
    })
    const moduleConfigService = buildModuleConfigService()
    const { default: handle } = await import('../repair-gateway-payments.worker')

    await handle(buildJob({ tenantId: TENANT_ID, organizationId: ORG_ID, batchSize: 50 }), buildCtx(em, moduleConfigService))
    expect(mockRecordGatewayPayment).not.toHaveBeenCalled()
    expect(moduleConfigService.setValue).toHaveBeenCalled()
    const firstRunCallCount = findMock.mock.calls.length

    await handle(buildJob({ tenantId: TENANT_ID, organizationId: ORG_ID, batchSize: 50 }), buildCtx(em, moduleConfigService))

    expect(mockRecordGatewayPayment).toHaveBeenCalledTimes(1)
    expect(mockRecordGatewayPayment.mock.calls[0][4]).toBe('order-beyond-first-run-budget')
    // The second run reaches the outstanding row within its own page budget, starting from
    // the persisted cursor rather than re-scanning all 5000 already-correct rows again.
    expect(findMock.mock.calls.length - firstRunCallCount).toBeLessThan(5)
  })
})
