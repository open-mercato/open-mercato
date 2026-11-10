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
})
