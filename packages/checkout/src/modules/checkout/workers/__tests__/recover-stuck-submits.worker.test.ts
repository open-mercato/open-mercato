// Release 5, Step 4.2 (C24, §12.1). The recovery decision table, reduced to the
// `submitting`-only half (see the worker's own header comment): `continueOrderOutcome`
// resumes a session already at `document_created`/`finalized`; anything earlier
// compensates (release stock/credit by the session's own stored keys, unlock, reopen) —
// never a parallel reimplementation of either primitive.

import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { JobContext, QueuedJob } from '@open-mercato/queue'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CheckoutSession } from '../../data/entities'
import type { RecoverStuckSubmitsJob } from '../recover-stuck-submits.worker'

const mockFindWithDecryption = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

const mockWriteSessionEvent = jest.fn(async () => undefined)
jest.mock('../../lib/sessionEvents', () => ({
  writeSessionEvent: (...args: unknown[]) => mockWriteSessionEvent(...args),
}))

const mockEmitCheckoutEvent = jest.fn(async () => undefined)
jest.mock('../../events', () => ({
  emitCheckoutEvent: (...args: unknown[]) => mockEmitCheckoutEvent(...args),
}))

const mockCompensate = jest.fn(async () => undefined)
const mockCompensateByCancellingOrder = jest.fn(async () => undefined)
const mockContinueOrderOutcome = jest.fn(async () => ({
  session: {},
  attempt: 1,
  stockReservationKey: null,
  creditReservationKey: null,
  salesQuoteId: 'quote-1',
  salesOrderId: 'order-1',
}))
jest.mock('../../commands/submit', () => ({
  compensate: (...args: unknown[]) => mockCompensate(...args),
  compensateByCancellingOrder: (...args: unknown[]) => mockCompensateByCancellingOrder(...args),
  continueOrderOutcome: (...args: unknown[]) => mockContinueOrderOutcome(...args),
}))

const TENANT_ID = 'tenant-recover-1'
const ORG_ID = 'org-recover-1'

function makeSession(overrides: Partial<CheckoutSession> = {}): CheckoutSession {
  return {
    id: 'session-recover-1',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    cartId: 'cart-recover-1',
    status: 'submitting',
    submitAttempt: 1,
    submitProgress: null,
    submitStartedAt: new Date('2026-01-01T00:00:00.000Z'),
    stockReservationKey: 'checkout:session-recover-1:1:stock',
    creditReservationKey: null,
    salesQuoteId: null,
    salesOrderId: null,
    paymentMethodCode: 'gateway:acme',
    ...overrides,
  } as CheckoutSession
}

describe('checkout recover-stuck-submits worker', () => {
  const mockCartServiceUnlock = jest.fn(async () => ({ cart: { status: 'active' } }))
  const mockEm = {
    fork: () => mockEm,
    nativeUpdate: jest.fn(async () => 1),
  }

  const resolve = <T = unknown>(name: string): T => {
    if (name === 'em') return mockEm as unknown as T
    if (name === 'cartService') return { unlock: mockCartServiceUnlock } as unknown as T
    throw new Error(`[internal] Missing dependency: ${name}`)
  }

  const mockContext: JobContext & { resolve: typeof resolve } = {
    resolve,
    jobId: 'job-1',
    attemptNumber: 1,
    queueName: 'checkout-recover-stuck-submits',
  }

  const baseJob = { id: 'job-1', createdAt: '2026-01-01T00:00:00.000Z' }

  beforeEach(() => {
    jest.clearAllMocks()
    mockCartServiceUnlock.mockResolvedValue({ cart: { status: 'active' } })
  })

  it('throws when tenantId or organizationId is missing', async () => {
    const { default: handle } = await import('../recover-stuck-submits.worker')

    await expect(
      handle({ ...baseJob, payload: {} } as unknown as QueuedJob<RecoverStuckSubmitsJob>, mockContext),
    ).rejects.toThrow('[internal] tenantId and organizationId are required in RecoverStuckSubmitsJob')
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  it('queries only sessions stuck in submitting, scoped by tenant/organization', async () => {
    mockFindWithDecryption.mockResolvedValueOnce([])
    const { default: handle } = await import('../recover-stuck-submits.worker')

    await handle(
      { ...baseJob, payload: { tenantId: TENANT_ID, organizationId: ORG_ID, batchSize: 10 } } as unknown as QueuedJob<RecoverStuckSubmitsJob>,
      mockContext,
    )

    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      mockEm,
      CheckoutSession,
      expect.objectContaining({ tenantId: TENANT_ID, organizationId: ORG_ID, status: 'submitting' }),
      expect.objectContaining({ limit: 10 }),
      { tenantId: TENANT_ID, organizationId: ORG_ID },
    )
  })

  it('resumes forward (C24) for a session already at document_created, via continueOrderOutcome', async () => {
    const session = makeSession({ submitProgress: 'document_created', salesQuoteId: 'quote-1', salesOrderId: 'order-1' })
    mockFindWithDecryption.mockResolvedValueOnce([session])
    const { default: handle } = await import('../recover-stuck-submits.worker')

    await handle(
      { ...baseJob, payload: { tenantId: TENANT_ID, organizationId: ORG_ID } } as unknown as QueuedJob<RecoverStuckSubmitsJob>,
      mockContext,
    )

    expect(mockContinueOrderOutcome).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      session,
      quoteId: 'quote-1',
      orderId: 'order-1',
      paymentMethodCode: 'gateway:acme',
      stockReservationKey: session.stockReservationKey,
    }))
    expect(mockCompensate).not.toHaveBeenCalled()
    expect(mockWriteSessionEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'recovery', payload: expect.objectContaining({ action: 'resumed' }) }))
  })

  it('resumes forward for a session at finalized (no intent yet), via continueOrderOutcome', async () => {
    const session = makeSession({ submitProgress: 'finalized', salesQuoteId: 'quote-1', salesOrderId: 'order-1' })
    mockFindWithDecryption.mockResolvedValueOnce([session])
    const { default: handle } = await import('../recover-stuck-submits.worker')

    await handle(
      { ...baseJob, payload: { tenantId: TENANT_ID, organizationId: ORG_ID } } as unknown as QueuedJob<RecoverStuckSubmitsJob>,
      mockContext,
    )

    expect(mockContinueOrderOutcome).toHaveBeenCalledTimes(1)
  })

  it('a crashed attempt still at submit_progress null compensates: releases stock/credit by the session\'s own stored keys and unlocks, never a hand-rolled parallel release', async () => {
    const session = makeSession({ submitProgress: null, creditReservationKey: 'checkout:session-recover-1:1:credit' })
    mockFindWithDecryption.mockResolvedValueOnce([session])
    const { default: handle } = await import('../recover-stuck-submits.worker')

    await handle(
      { ...baseJob, payload: { tenantId: TENANT_ID, organizationId: ORG_ID } } as unknown as QueuedJob<RecoverStuckSubmitsJob>,
      mockContext,
    )

    expect(mockCartServiceUnlock).toHaveBeenCalledWith(expect.objectContaining({ cartId: session.cartId, checkoutSessionId: session.id }))
    expect(mockCompensate).toHaveBeenCalledWith(
      expect.anything(),
      mockEm,
      session,
      { tenantId: TENANT_ID, organizationId: ORG_ID },
      { releaseCredit: true, releaseStock: true, unlockCart: false },
      { stockReservationKey: session.stockReservationKey, creditReservationKey: session.creditReservationKey },
    )
    expect(mockContinueOrderOutcome).not.toHaveBeenCalled()
  })

  it('a 404 from cart.unlock (never actually locked) is swallowed, not treated as a failure', async () => {
    const session = makeSession({ submitProgress: null })
    mockFindWithDecryption.mockResolvedValueOnce([session])
    mockCartServiceUnlock.mockRejectedValueOnce(new CrudHttpError(404, { error: '[internal] checkout session not found' }))
    const { default: handle } = await import('../recover-stuck-submits.worker')

    await handle(
      { ...baseJob, payload: { tenantId: TENANT_ID, organizationId: ORG_ID } } as unknown as QueuedJob<RecoverStuckSubmitsJob>,
      mockContext,
    )

    expect(mockCompensate).toHaveBeenCalled()
  })

  it('gives up and compensates by failing the session once the attempt is past the give-up window', async () => {
    const session = makeSession({
      submitProgress: 'document_created',
      salesQuoteId: 'quote-1',
      salesOrderId: 'order-1',
      submitStartedAt: new Date(Date.now() - 40 * 60 * 1000),
    })
    mockFindWithDecryption.mockResolvedValueOnce([session])
    mockContinueOrderOutcome.mockRejectedValueOnce(new Error('still broken'))
    const { default: handle } = await import('../recover-stuck-submits.worker')

    await handle(
      { ...baseJob, payload: { tenantId: TENANT_ID, organizationId: ORG_ID } } as unknown as QueuedJob<RecoverStuckSubmitsJob>,
      mockContext,
    )

    // The order already exists at this point (`salesOrderId` is set), so giving up must
    // CANCEL it — via the same `compensateByCancellingOrder` primitive the live submit
    // path uses — never just mark the session failed with the order left dangling
    // (unconfirmed, stock/credit/promotions never released).
    expect(mockCompensateByCancellingOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      session,
      { tenantId: TENANT_ID, organizationId: ORG_ID },
      'order-1',
      'submit_recovery_failed',
    )
  })

  it('a resume failure within the give-up window is logged and left for the next tick, not compensated', async () => {
    const session = makeSession({
      submitProgress: 'document_created',
      salesQuoteId: 'quote-1',
      salesOrderId: 'order-1',
      submitStartedAt: new Date(), // just started — well within the give-up window
    })
    mockFindWithDecryption.mockResolvedValueOnce([session])
    mockContinueOrderOutcome.mockRejectedValueOnce(new Error('transient'))
    const { default: handle } = await import('../recover-stuck-submits.worker')

    await handle(
      { ...baseJob, payload: { tenantId: TENANT_ID, organizationId: ORG_ID } } as unknown as QueuedJob<RecoverStuckSubmitsJob>,
      mockContext,
    )

    expect(mockEm.nativeUpdate).not.toHaveBeenCalled()
    expect(mockCompensate).not.toHaveBeenCalled()
  })

  it('a single session recovery failure does not stop the batch', async () => {
    const session1 = makeSession({ id: 'session-recover-1', submitProgress: null })
    const session2 = makeSession({ id: 'session-recover-2', submitProgress: null })
    mockFindWithDecryption.mockResolvedValueOnce([session1, session2])
    mockCartServiceUnlock.mockRejectedValueOnce(new Error('unexpected'))
    const { default: handle } = await import('../recover-stuck-submits.worker')

    await handle(
      { ...baseJob, payload: { tenantId: TENANT_ID, organizationId: ORG_ID } } as unknown as QueuedJob<RecoverStuckSubmitsJob>,
      mockContext,
    )

    expect(mockCompensate).toHaveBeenCalledTimes(1)
    expect(mockCompensate).toHaveBeenCalledWith(expect.anything(), expect.anything(), session2, expect.anything(), expect.anything(), expect.anything())
  })
})
