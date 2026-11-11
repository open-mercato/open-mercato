// #8268 review Medium 7 / finding 3: `recordGatewayPayment`'s own 3 immediate in-process
// retries (`commands/submit.ts`) can all fail, leaving a paid order with no `SalesPayment`.
// This worker selects only outstanding work (`paymentRecordedAt IS NULL`) and re-runs the
// REAL `recordGatewayPayment` against an in-memory store, so these tests exercise the
// actual selection, marking, reset and fairness behaviour rather than a mocked primitive.

import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { JobContext, QueuedJob } from '@open-mercato/queue'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { CheckoutSession, CheckoutTransaction } from '../../data/entities'
import type { RepairGatewayPaymentsJob } from '../repair-gateway-payments.worker'
import handle from '../repair-gateway-payments.worker'
import '../../commands/transactions'

jest.mock('@open-mercato/shared/lib/logger', () => {
  const logger = { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn(), child: jest.fn() }
  logger.child.mockReturnValue(logger)
  return { createLogger: () => logger }
})

const mockReportError = jest.fn()
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }),
}))

type MockLogger = Record<'debug' | 'error' | 'info' | 'warn' | 'child', jest.Mock>
const mockLogger = (jest.requireMock('@open-mercato/shared/lib/logger') as { createLogger: () => MockLogger }).createLogger()

type Row = Record<string, unknown>
type Where = Record<string, unknown>
type OrderBy = Record<string, string>
type FindOptions = { orderBy?: OrderBy; limit?: number }
type CommandInput = { input: Record<string, unknown> }

const TENANT_ID = '00000000-0000-4000-8000-00000000a001'
const ORG_ID = '00000000-0000-4000-8000-00000000b001'
const OTHER_ORG_ID = '00000000-0000-4000-8000-00000000b002'
const HOUR_MS = 60 * 60 * 1000

function uuid(prefix: string, index: number): string {
  return `00000000-0000-4000-8000-${prefix}${String(index).padStart(12 - prefix.length, '0')}`
}

function compareValues(left: unknown, right: unknown): number {
  const leftValue = left instanceof Date ? left.getTime() : left
  const rightValue = right instanceof Date ? right.getTime() : right
  if (typeof leftValue === 'number' && typeof rightValue === 'number') return leftValue - rightValue
  return String(leftValue) < String(rightValue) ? -1 : String(leftValue) > String(rightValue) ? 1 : 0
}

function matchesValue(actual: unknown, expected: unknown): boolean {
  if (expected === null) return actual === null || actual === undefined
  if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime()
  if (typeof expected === 'object') {
    return Object.entries(expected as Record<string, unknown>).every(([operator, operand]) => {
      if (operator === '$ne') return operand === null ? actual !== null && actual !== undefined : actual !== operand
      if (operator === '$in') return Array.isArray(operand) && operand.includes(actual)
      if (operator === '$gt') return compareValues(actual, operand) > 0
      if (operator === '$gte') return compareValues(actual, operand) >= 0
      if (operator === '$lt') return compareValues(actual, operand) < 0
      throw new Error(`[internal] unsupported operator in test store: ${operator}`)
    })
  }
  return actual === expected
}

function matchesWhere(row: Row, where: Where): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === '$or') return (expected as Where[]).some((clause) => matchesWhere(row, clause))
    if (expected === undefined) return true
    return matchesValue(row[key], expected)
  })
}

function compareRows(left: Row, right: Row, orderBy: OrderBy): number {
  for (const [key, direction] of Object.entries(orderBy)) {
    const normalized = direction.toUpperCase()
    const descending = normalized.startsWith('DESC')
    const nullsFirst = normalized.includes('NULLS FIRST') ? true : normalized.includes('NULLS LAST') ? false : descending
    const leftValue = left[key]
    const rightValue = right[key]
    const leftNull = leftValue === null || leftValue === undefined
    const rightNull = rightValue === null || rightValue === undefined
    if (leftNull && rightNull) continue
    if (leftNull) return nullsFirst ? -1 : 1
    if (rightNull) return nullsFirst ? 1 : -1
    const diff = compareValues(leftValue, rightValue)
    if (diff !== 0) return descending ? -diff : diff
  }
  return 0
}

function buildStore() {
  const transactions: Row[] = []
  const sessions: Row[] = []
  const payments: Row[] = []
  const failingOrderIds = new Set<string>()
  const throwingSessionIds = new Set<string>()
  let onPaymentCreate: ((input: Record<string, unknown>) => Promise<void>) | null = null

  const find = jest.fn(async (entity: unknown, where: Where, options?: FindOptions) => {
    if (entity !== CheckoutTransaction) return []
    let rows = transactions.filter((row) => matchesWhere(row, where))
    if (options?.orderBy) rows = [...rows].sort((left, right) => compareRows(left, right, options.orderBy as OrderBy))
    if (typeof options?.limit === 'number') rows = rows.slice(0, options.limit)
    return rows.map((row) => ({ ...row }))
  })
  const findOne = jest.fn(async (entity: unknown, where: Where) => {
    if (entity === CheckoutSession) {
      if (typeof where.id === 'string' && throwingSessionIds.has(where.id)) throw new Error('[internal] session lookup failed')
      const session = sessions.find((row) => matchesWhere(row, where))
      return session ? { ...session } : null
    }
    if (entity === CheckoutTransaction) {
      const transaction = transactions.find((row) => matchesWhere(row, where))
      return transaction ? { ...transaction } : null
    }
    return null
  })
  const nativeUpdate = jest.fn(async (entity: unknown, where: Where, set: Row) => {
    if (entity !== CheckoutTransaction) return 0
    const matched = transactions.filter((row) => matchesWhere(row, where))
    for (const row of matched) Object.assign(row, set)
    return matched.length
  })

  function kyselyBuilder(table: string) {
    const filters: Array<{ column: string; operator: string; value: unknown }> = []
    const source = table === 'sales_payments' ? payments : []
    const matches = (row: Row) => filters.every(({ column, operator, value }) => {
      const key = column.slice(column.lastIndexOf('.') + 1)
      if (operator === 'in') return Array.isArray(value) && value.includes(row[key])
      if (operator === 'is') return value === null ? row[key] === null || row[key] === undefined : row[key] === value
      return row[key] === value
    })
    const builder = {
      select: () => builder,
      innerJoin: () => builder,
      where: (column: string, operator: string, value: unknown) => {
        filters.push({ column, operator, value })
        return builder
      },
      executeTakeFirst: async () => source.find(matches),
      execute: async () => source.filter(matches),
    }
    return builder
  }

  const em: Row = {
    find,
    findOne,
    nativeUpdate,
    flush: async () => undefined,
    refresh: async () => undefined,
    getKysely: () => ({ selectFrom: (table: string) => kyselyBuilder(table) }),
  }
  em.fork = () => em
  em.transactional = async (callback: (tx: Row) => Promise<unknown>) => callback(em)

  const commandBusExecute = jest.fn(async (id: string, options: CommandInput) => {
    const input = options.input
    if (id === 'sales.payments.create') {
      if (failingOrderIds.has(input.orderId as string)) throw new Error('[internal] sales ledger rejected the payment')
      if (onPaymentCreate) await onPaymentCreate(input)
      const paymentId = `payment-${payments.length + 1}`
      payments.push({
        id: paymentId,
        tenant_id: input.tenantId,
        organization_id: input.organizationId,
        order_id: input.orderId,
        payment_reference: input.paymentReference ?? null,
        captured_amount: input.capturedAmount ?? '0',
        deleted_at: null,
      })
      return { result: { paymentId } }
    }
    if (id === 'sales.payments.update') {
      const payment = payments.find((row) => row.id === input.id)
      if (payment && input.capturedAmount !== undefined) payment.captured_amount = input.capturedAmount
      return { result: { paymentId: input.id } }
    }
    throw new Error(`[internal] unexpected command in test store: ${id}`)
  })

  let sequence = 0
  function seedTransaction(overrides: Row = {}): Row {
    sequence += 1
    const transaction: Row = {
      id: uuid('1', sequence),
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      linkId: null,
      sessionId: uuid('2', sequence),
      orderId: uuid('3', sequence),
      status: 'completed',
      amount: '42.00',
      currencyCode: 'USD',
      gatewayTransactionId: uuid('4', sequence),
      paymentStatus: 'captured',
      paymentRecordedAt: null,
      paymentRepairAttemptedAt: null,
      updatedAt: new Date(Date.now() - HOUR_MS + sequence),
      ...overrides,
    }
    transactions.push(transaction)
    sessions.push({ id: transaction.sessionId, tenantId: transaction.tenantId, organizationId: transaction.organizationId })
    return transaction
  }

  function seedRecordedTransaction(overrides: Row = {}): Row {
    const transaction = seedTransaction({ paymentRecordedAt: new Date(Date.now() - HOUR_MS), ...overrides })
    payments.push({
      id: `payment-${payments.length + 1}`,
      tenant_id: transaction.tenantId,
      organization_id: transaction.organizationId,
      order_id: transaction.orderId,
      payment_reference: transaction.gatewayTransactionId,
      captured_amount: transaction.paymentStatus === 'authorized' ? '0' : transaction.amount,
      deleted_at: null,
    })
    return transaction
  }

  const ctx = {
    resolve: <T = unknown>(name: string): T => {
      if (name === 'em') return em as T
      if (name === 'commandBus') return { execute: commandBusExecute } as T
      throw new Error(`[internal] Missing dependency: ${name}`)
    },
  } as unknown as JobContext & { resolve: <T = unknown>(name: string) => T }

  return {
    transactions,
    sessions,
    payments,
    failingOrderIds,
    throwingSessionIds,
    find,
    nativeUpdate,
    commandBusExecute,
    ctx,
    seedTransaction,
    seedRecordedTransaction,
    setOnPaymentCreate: (callback: ((input: Record<string, unknown>) => Promise<void>) | null) => { onPaymentCreate = callback },
    paymentsFor: (transaction: Row) => payments.filter((payment) => payment.order_id === transaction.orderId),
    createdOrderIds: () => commandBusExecute.mock.calls
      .filter(([id]) => id === 'sales.payments.create')
      .map(([, options]) => options.input.orderId),
  }
}

type Store = ReturnType<typeof buildStore>

function sweep(store: Store, payload: Partial<RepairGatewayPaymentsJob> = {}) {
  return handle({ payload: { tenantId: TENANT_ID, organizationId: ORG_ID, ...payload } } as QueuedJob<RepairGatewayPaymentsJob>, store.ctx)
}

async function updateTransactionStatus(store: Store, input: Record<string, unknown>) {
  const handler = commandRegistry.get<Record<string, unknown>, { ok: true }>('checkout.transaction.updateStatus')
  if (!handler) throw new Error('[internal] checkout.transaction.updateStatus is not registered')
  const ctx = {
    container: { resolve: (name: string) => (name === 'em' ? store.ctx.resolve('em') : null) },
    auth: null,
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
  } as unknown as CommandRuntimeContext
  await handler.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, ...input }, ctx)
}

describe('checkout repair-gateway-payments worker', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockLogger.child.mockReturnValue(mockLogger)
    mockReportError.mockImplementation(() => undefined)
  })

  it('records an outstanding captured transaction from its own row and marks it recorded', async () => {
    const store = buildStore()
    const transaction = store.seedTransaction()

    await sweep(store)

    expect(store.paymentsFor(transaction)).toEqual([
      expect.objectContaining({ payment_reference: transaction.gatewayTransactionId, captured_amount: '42.00' }),
    ])
    expect(transaction.paymentRecordedAt).toBeInstanceOf(Date)
    expect(transaction.paymentRepairAttemptedAt).toBeInstanceOf(Date)
  })

  it('records a still-authorized transaction without booking a capture, and marks it recorded', async () => {
    const store = buildStore()
    const transaction = store.seedTransaction({ paymentStatus: 'authorized' })

    await sweep(store)

    expect(store.paymentsFor(transaction)).toEqual([expect.objectContaining({ captured_amount: '0' })])
    expect(transaction.paymentRecordedAt).toBeInstanceOf(Date)
  })

  it('leaves a row outstanding while its payment record keeps failing, then marks it once the ledger recovers', async () => {
    const store = buildStore()
    const transaction = store.seedTransaction()
    store.failingOrderIds.add(transaction.orderId as string)

    await sweep(store)

    expect(store.paymentsFor(transaction)).toHaveLength(0)
    expect(transaction.paymentRecordedAt).toBeNull()
    expect(mockReportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ module: 'checkout', code: 'checkout.gateway_payment_record_failed' }),
    )

    store.failingOrderIds.clear()
    await sweep(store)

    expect(store.paymentsFor(transaction)).toHaveLength(1)
    expect(transaction.paymentRecordedAt).toBeInstanceOf(Date)
  })

  it('finding 3: selects only outstanding rows, so thousands of already-recorded rows never hide an unrecorded one', async () => {
    const store = buildStore()
    for (let index = 0; index < 5000; index += 1) {
      store.seedRecordedTransaction({ updatedAt: new Date(Date.now() - 2 * HOUR_MS + index) })
    }
    const otherOrganization = store.seedTransaction({ organizationId: OTHER_ORG_ID })
    const outstanding = store.seedTransaction({ updatedAt: new Date(Date.now() - 1000) })

    await sweep(store, { batchSize: 50 })

    expect(store.createdOrderIds()).toEqual([outstanding.orderId])
    expect(outstanding.paymentRecordedAt).toBeInstanceOf(Date)
    expect(store.find).toHaveBeenCalledTimes(1)
    await expect(store.find.mock.results[0].value).resolves.toHaveLength(1)
    expect(otherOrganization.paymentRecordedAt).toBeNull()
    expect(otherOrganization.paymentRepairAttemptedAt).toBeNull()
  })

  it('finding 3: repeated sweeps with no moduleConfigService registered reach every outstanding row, including one behind more than 20 recorded ancient rows', async () => {
    const store = buildStore()
    const threeDaysAgo = Date.now() - 72 * HOUR_MS
    for (let index = 0; index < 25; index += 1) {
      store.seedRecordedTransaction({ updatedAt: new Date(threeDaysAgo + index) })
    }
    const ancientOutstanding = store.seedTransaction({ updatedAt: new Date(threeDaysAgo + 100) })
    for (let index = 0; index < 30; index += 1) {
      store.seedRecordedTransaction({ updatedAt: new Date(Date.now() - HOUR_MS + index) })
    }
    const recentOutstanding = store.seedTransaction({ updatedAt: new Date(Date.now() - 1000) })
    expect(() => store.ctx.resolve('moduleConfigService')).toThrow()

    for (let run = 0; run < 3; run += 1) {
      await sweep(store, { batchSize: 50 })
    }

    expect(store.paymentsFor(ancientOutstanding)).toHaveLength(1)
    expect(store.paymentsFor(recentOutstanding)).toHaveLength(1)
    expect(ancientOutstanding.paymentRecordedAt).toBeInstanceOf(Date)
    expect(recentOutstanding.paymentRecordedAt).toBeInstanceOf(Date)
  })

  it('does not touch a recorded row again on a repeated sweep', async () => {
    const store = buildStore()
    store.seedTransaction()

    await sweep(store)
    store.commandBusExecute.mockClear()
    store.nativeUpdate.mockClear()
    await sweep(store)

    expect(store.commandBusExecute).not.toHaveBeenCalled()
    expect(store.nativeUpdate).not.toHaveBeenCalled()
  })

  it('finding 3: authorized → captured through checkout.transaction.updateStatus clears the marker, and the next sweep reconciles the capture', async () => {
    const store = buildStore()
    const transaction = store.seedRecordedTransaction({ paymentStatus: 'authorized' })
    expect(store.paymentsFor(transaction)).toEqual([expect.objectContaining({ captured_amount: '0' })])

    await updateTransactionStatus(store, {
      id: transaction.id,
      status: 'completed',
      paymentStatus: 'captured',
      gatewayTransactionId: transaction.gatewayTransactionId,
    })

    expect(transaction.paymentStatus).toBe('captured')
    expect(transaction.paymentRecordedAt).toBeNull()

    await sweep(store)

    expect(store.paymentsFor(transaction)).toEqual([expect.objectContaining({ captured_amount: '42.00' })])
    expect(transaction.paymentRecordedAt).toBeInstanceOf(Date)
  })

  it('finding 3: a capture landing while an authorized repair is in flight is not marked recorded by that repair', async () => {
    const store = buildStore()
    const transaction = store.seedTransaction({ paymentStatus: 'authorized' })
    store.setOnPaymentCreate(async () => {
      store.setOnPaymentCreate(null)
      await updateTransactionStatus(store, {
        id: transaction.id,
        status: 'completed',
        paymentStatus: 'captured',
        gatewayTransactionId: transaction.gatewayTransactionId,
      })
    })

    await sweep(store)

    expect(store.paymentsFor(transaction)).toEqual([expect.objectContaining({ captured_amount: '0' })])
    expect(transaction.paymentStatus).toBe('captured')
    expect(transaction.paymentRecordedAt).toBeNull()

    await sweep(store)

    expect(store.paymentsFor(transaction)).toEqual([expect.objectContaining({ captured_amount: '42.00' })])
    expect(transaction.paymentRecordedAt).toBeInstanceOf(Date)
  })

  it('finding 3: a permanently failing row does not starve the rows behind it', async () => {
    const store = buildStore()
    const failing = store.seedTransaction({ updatedAt: new Date(Date.now() - 3 * HOUR_MS) })
    const second = store.seedTransaction({ updatedAt: new Date(Date.now() - 2 * HOUR_MS) })
    const third = store.seedTransaction({ updatedAt: new Date(Date.now() - HOUR_MS) })
    store.failingOrderIds.add(failing.orderId as string)

    for (let run = 0; run < 3; run += 1) {
      await sweep(store, { batchSize: 1 })
    }

    expect(store.paymentsFor(second)).toHaveLength(1)
    expect(store.paymentsFor(third)).toHaveLength(1)
    expect(second.paymentRecordedAt).toBeInstanceOf(Date)
    expect(third.paymentRecordedAt).toBeInstanceOf(Date)
    expect(failing.paymentRecordedAt).toBeNull()
    expect(failing.paymentRepairAttemptedAt).toBeInstanceOf(Date)
    expect(store.createdOrderIds().filter((orderId) => orderId === failing.orderId)).toHaveLength(3)
  })

  it('finding 4: reports every caught failure, and a throwing telemetry backend does not break the run', async () => {
    const store = buildStore()
    const sessionLookupFails = store.seedTransaction()
    const recordFails = store.seedTransaction()
    const healthy = store.seedTransaction()
    store.throwingSessionIds.add(sessionLookupFails.sessionId as string)
    store.failingOrderIds.add(recordFails.orderId as string)
    mockReportError.mockImplementation(() => {
      throw new Error('[internal] telemetry backend unavailable')
    })

    await expect(sweep(store)).resolves.toBeUndefined()

    expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), {
      module: 'checkout',
      code: 'checkout.gateway_payment_repair_failed',
      attributes: { tenantId: TENANT_ID, organizationId: ORG_ID, transactionId: sessionLookupFails.id },
    })
    expect(mockReportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ code: 'checkout.gateway_payment_record_failed' }),
    )
    expect(store.paymentsFor(healthy)).toHaveLength(1)
    expect(healthy.paymentRecordedAt).toBeInstanceOf(Date)
    expect(sessionLookupFails.paymentRecordedAt).toBeNull()
    expect(recordFails.paymentRecordedAt).toBeNull()
  })

  it('skips a transaction whose checkout session no longer exists, leaving it outstanding', async () => {
    const store = buildStore()
    const transaction = store.seedTransaction()
    store.sessions.splice(0, store.sessions.length)

    await sweep(store)

    expect(store.commandBusExecute).not.toHaveBeenCalled()
    expect(transaction.paymentRecordedAt).toBeNull()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      '[internal] repair-gateway-payments: the transaction\'s checkout session no longer exists',
      expect.objectContaining({ transactionId: transaction.id }),
    )
  })

  it('requires tenantId and organizationId in the job payload', async () => {
    const store = buildStore()

    await expect(handle({ payload: {} } as QueuedJob<RepairGatewayPaymentsJob>, store.ctx)).rejects.toThrow(
      '[internal] tenantId and organizationId are required in RepairGatewayPaymentsJob',
    )
  })
})
