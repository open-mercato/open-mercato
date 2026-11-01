// PR 8268 review fix (Finding 5 follow-up, §12): `expire-checkout-sessions` closes the
// permanent pay-link slot leak `commands/session.ts`'s `{ source: 'link' }` branch and
// `commands/submit.ts`'s generic `compensate()` path both leave behind — neither releases
// `reserveCheckoutLinkSlot`'s hold for a session the buyer simply never finishes. This
// sweep is the "job-driven open -> expired / awaiting_approval -> expired" path
// `lib/session-status-machine.ts` already documents as reachable, but nothing drove until
// now — mirrors `transaction-expiry.worker.ts`'s own shape for the Phase A flow.

import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { JobContext, QueuedJob } from '@open-mercato/queue'
import { CheckoutSession } from '../../data/entities'
import type { ExpireCheckoutSessionsJob } from '../expire-checkout-sessions.worker'

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

const mockReleaseCheckoutLinkSlot = jest.fn(async () => undefined)
jest.mock('../../lib/payLinkCartSeed', () => ({
  releaseCheckoutLinkSlot: (...args: unknown[]) => mockReleaseCheckoutLinkSlot(...args),
}))

const TENANT_ID = 'tenant-expire-sessions-1'
const ORG_ID = 'org-expire-sessions-1'

function makeSession(overrides: Partial<CheckoutSession> = {}): CheckoutSession {
  return {
    id: 'session-expire-sessions-1',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    cartId: 'cart-expire-sessions-1',
    linkId: null,
    status: 'open',
    expiresAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as CheckoutSession
}

describe('checkout expire-checkout-sessions worker', () => {
  const mockNativeUpdate = jest.fn(async () => 1)
  const mockEm = {
    fork: () => mockEm,
    nativeUpdate: (...args: unknown[]) => mockNativeUpdate(...args),
  }

  const resolve = <T = unknown>(name: string): T => {
    if (name === 'em') return mockEm as unknown as T
    throw new Error(`[internal] Missing dependency: ${name}`)
  }

  const mockContext: JobContext & { resolve: typeof resolve } = {
    resolve,
    jobId: 'job-1',
    attemptNumber: 1,
    queueName: 'checkout-expire-sessions',
  }

  const baseJob = { id: 'job-1', createdAt: '2026-01-01T00:00:00.000Z' }

  beforeEach(() => {
    jest.clearAllMocks()
    mockNativeUpdate.mockResolvedValue(1)
  })

  it('throws when tenantId or organizationId is missing', async () => {
    const { default: handle } = await import('../expire-checkout-sessions.worker')

    await expect(
      handle({ ...baseJob, payload: {} } as unknown as QueuedJob<ExpireCheckoutSessionsJob>, mockContext),
    ).rejects.toThrow('[internal] tenantId and organizationId are required in ExpireCheckoutSessionsJob')
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  it('queries only open/awaiting_approval sessions past their own expiresAt, scoped by tenant/organization', async () => {
    mockFindWithDecryption.mockResolvedValueOnce([])
    const { default: handle } = await import('../expire-checkout-sessions.worker')

    await handle(
      { ...baseJob, payload: { tenantId: TENANT_ID, organizationId: ORG_ID, batchSize: 10 } } as unknown as QueuedJob<ExpireCheckoutSessionsJob>,
      mockContext,
    )

    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      mockEm,
      CheckoutSession,
      expect.objectContaining({
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        status: { $in: ['open', 'awaiting_approval'] },
        expiresAt: { $lt: expect.any(Date) },
      }),
      expect.objectContaining({ limit: 10 }),
      { tenantId: TENANT_ID, organizationId: ORG_ID },
    )
  })

  it('an abandoned, never-submitted, now-expired link session is moved to expired and its reserved slot is released', async () => {
    const session = makeSession({ linkId: 'link-1' })
    mockFindWithDecryption.mockResolvedValueOnce([session])
    const { default: handle } = await import('../expire-checkout-sessions.worker')

    await handle(
      { ...baseJob, payload: { tenantId: TENANT_ID, organizationId: ORG_ID } } as unknown as QueuedJob<ExpireCheckoutSessionsJob>,
      mockContext,
    )

    expect(mockNativeUpdate).toHaveBeenCalledWith(
      CheckoutSession,
      { id: session.id, tenantId: TENANT_ID, organizationId: ORG_ID, status: 'open' },
      expect.objectContaining({ status: 'expired' }),
    )
    expect(mockReleaseCheckoutLinkSlot).toHaveBeenCalledWith(
      mockEm,
      { tenantId: TENANT_ID, organizationId: ORG_ID },
      'link-1',
      { completed: false },
    )
    expect(mockWriteSessionEvent).toHaveBeenCalledWith(mockEm, expect.objectContaining({ sessionId: session.id, kind: 'session_expired' }))
    expect(mockEmitCheckoutEvent).toHaveBeenCalledWith('checkout.session.expired', expect.objectContaining({ sessionId: session.id }))
  })

  it('an expired session with no linkId expires without touching a pay-link reservation', async () => {
    const session = makeSession({ linkId: null })
    mockFindWithDecryption.mockResolvedValueOnce([session])
    const { default: handle } = await import('../expire-checkout-sessions.worker')

    await handle(
      { ...baseJob, payload: { tenantId: TENANT_ID, organizationId: ORG_ID } } as unknown as QueuedJob<ExpireCheckoutSessionsJob>,
      mockContext,
    )

    expect(mockReleaseCheckoutLinkSlot).not.toHaveBeenCalled()
    expect(mockWriteSessionEvent).toHaveBeenCalled()
  })

  it('a session a concurrent writer already moved out of the observed status is skipped, never double-processed', async () => {
    const session = makeSession({ linkId: 'link-1', status: 'awaiting_approval' })
    mockFindWithDecryption.mockResolvedValueOnce([session])
    mockNativeUpdate.mockResolvedValueOnce(0)
    const { default: handle } = await import('../expire-checkout-sessions.worker')

    await handle(
      { ...baseJob, payload: { tenantId: TENANT_ID, organizationId: ORG_ID } } as unknown as QueuedJob<ExpireCheckoutSessionsJob>,
      mockContext,
    )

    expect(mockReleaseCheckoutLinkSlot).not.toHaveBeenCalled()
    expect(mockWriteSessionEvent).not.toHaveBeenCalled()
  })

  it('a single session failure does not stop the batch', async () => {
    const session1 = makeSession({ id: 'session-expire-sessions-1', linkId: 'link-1' })
    const session2 = makeSession({ id: 'session-expire-sessions-2', linkId: 'link-2' })
    mockFindWithDecryption.mockResolvedValueOnce([session1, session2])
    mockReleaseCheckoutLinkSlot.mockRejectedValueOnce(new Error('unexpected'))
    const { default: handle } = await import('../expire-checkout-sessions.worker')

    await handle(
      { ...baseJob, payload: { tenantId: TENANT_ID, organizationId: ORG_ID } } as unknown as QueuedJob<ExpireCheckoutSessionsJob>,
      mockContext,
    )

    expect(mockReleaseCheckoutLinkSlot).toHaveBeenCalledTimes(2)
  })
})
