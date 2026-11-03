/** @jest-environment node */

/**
 * Tests for the state-machine guard added to updateTransactionStatusCommand.
 *
 * Exercises:
 * 1. A terminal → non-terminal transition is rejected with a 409 before the
 *    nativeUpdate is even called.
 * 2. A non-terminal → terminal transition succeeds (nativeUpdate called with
 *    the correct WHERE clause locking the current status).
 * 3. When nativeUpdate returns 0 (concurrent write won the race), the command
 *    throws a 409 (concurrent_status_update) and does NOT proceed to emit
 *    terminal events.
 * 4. When nativeUpdate returns 1, the command succeeds and emits the correct
 *    terminal event.
 */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { CheckoutTransaction } from '../../data/entities'

// Register the transaction commands
import '../transactions'

jest.mock('../../events', () => ({
  emitCheckoutEvent: jest.fn(async () => undefined),
}))

const { emitCheckoutEvent } = jest.requireMock('../../events') as {
  emitCheckoutEvent: jest.Mock
}

const ORG_ID = '123e4567-e89b-12d3-a456-426614174000'
const TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const LINK_ID = '123e4567-e89b-12d3-a456-426614174010'
const TX_ID = '123e4567-e89b-12d3-a456-426614174020'

function makeTransaction(status: CheckoutTransaction['status']) {
  return {
    id: TX_ID,
    linkId: LINK_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    status,
    paymentStatus: null,
    gatewayTransactionId: null,
    amount: '100.00',
    currencyCode: 'USD',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

type LinkRow = {
  id: string
  organizationId: string
  tenantId: string
  slug: string
  templateId: string | null
  gatewayProviderKey: string
  activeReservationCount: number
  completionCount: number
  maxCompletions: number | null
  isLocked: boolean
  deletedAt: null
}

function makeLink(overrides: Partial<LinkRow> = {}): LinkRow {
  return {
    id: LINK_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    slug: 'test-link',
    templateId: null,
    gatewayProviderKey: 'stripe',
    activeReservationCount: 1,
    completionCount: 0,
    maxCompletions: null,
    isLocked: false,
    deletedAt: null,
    ...overrides,
  }
}

type ReleasedLinkRow = { completion_count: number; max_completions: number | null }

type MockEm = {
  findOne: jest.Mock
  nativeUpdate: jest.Mock
  execute: jest.Mock
  flush: jest.Mock
  refresh: jest.Mock
  transactional: (fn: (tx: MockEm) => Promise<unknown>) => Promise<unknown>
  link: LinkRow
}

function makeMockEm(
  transaction: ReturnType<typeof makeTransaction>,
  nativeUpdateResult = 1,
  // When nativeUpdate returns 0, the post-CAS findOne should return a
  // different status to simulate the winning writer's value.
  postCasStatus?: CheckoutTransaction['status'],
  options: { link?: LinkRow; released?: ReleasedLinkRow[] } = {},
): MockEm {
  let findOneCallCount = 0
  const link = options.link ?? makeLink()
  const released = options.released ?? [{ completion_count: 1, max_completions: null }]
  const mockTx: MockEm = {
    link,
    findOne: jest.fn(async (_entity: unknown, filter: Record<string, unknown>) => {
      findOneCallCount++
      if (filter.id === TX_ID) {
        // After a CAS miss (nativeUpdate=0) the command re-reads the row with
        // refresh:true to fetch the winning writer's status. Return the
        // post-CAS status on subsequent calls when one is provided.
        if (findOneCallCount > 1 && postCasStatus !== undefined) {
          return { ...transaction, status: postCasStatus }
        }
        return transaction
      }
      if (filter.id === LINK_ID) return link
      return null
    }),
    nativeUpdate: jest.fn(async () => nativeUpdateResult),
    execute: jest.fn(async () => released),
    flush: jest.fn(async () => undefined),
    refresh: jest.fn(async () => undefined),
    transactional: (fn) => fn(mockTx),
  }
  return mockTx
}

function makeContext(em: MockEm): CommandRuntimeContext {
  return {
    container: {
      resolve: (token: string) => {
        if (token === 'em') return em
        return null
      },
    } as unknown as CommandRuntimeContext['container'],
    auth: null,
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
  }
}

function baseInput(status: string) {
  return {
    id: TX_ID,
    status,
    paymentStatus: null,
    gatewayTransactionId: null,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
  }
}

function linkCounterUpdateCalls(em: MockEm) {
  return em.execute.mock.calls.filter(([sql]) => typeof sql === 'string' && sql.includes('UPDATE checkout_links'))
}

async function runUpdateStatus(em: MockEm, status: string) {
  const handler = commandRegistry.get('checkout.transaction.updateStatus')
  if (!handler) throw new Error('checkout.transaction.updateStatus not registered')
  return handler.execute(baseInput(status), makeContext(em))
}

describe('updateTransactionStatusCommand — state-machine guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('valid transitions', () => {
    it('processing → completed: calls nativeUpdate with status=processing in the WHERE clause', async () => {
      const transaction = makeTransaction('processing')
      const em = makeMockEm(transaction, 1)

      await runUpdateStatus(em, 'completed')

      expect(em.nativeUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: TX_ID,
          organizationId: ORG_ID,
          tenantId: TENANT_ID,
          status: 'processing', // pins the current status for atomicity
        }),
        expect.objectContaining({ status: 'completed' }),
      )
    })

    it('processing → completed: emits checkout.transaction.completed event', async () => {
      const transaction = makeTransaction('processing')
      const em = makeMockEm(transaction, 1)

      await runUpdateStatus(em, 'completed')

      expect(emitCheckoutEvent).toHaveBeenCalledWith(
        'checkout.transaction.completed',
        expect.any(Object),
      )
    })

    it('pending → processing: nativeUpdate is called with correct WHERE', async () => {
      const transaction = makeTransaction('pending')
      const em = makeMockEm(transaction, 1)

      await runUpdateStatus(em, 'processing')

      expect(em.nativeUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: 'pending' }),
        expect.objectContaining({ status: 'processing' }),
      )
    })

    it('pending → processing: does NOT emit a terminal event', async () => {
      const transaction = makeTransaction('pending')
      const em = makeMockEm(transaction, 1)

      await runUpdateStatus(em, 'processing')

      expect(emitCheckoutEvent).not.toHaveBeenCalledWith(
        'checkout.transaction.completed',
        expect.any(Object),
      )
      expect(emitCheckoutEvent).not.toHaveBeenCalledWith(
        'checkout.transaction.failed',
        expect.any(Object),
      )
    })
  })

  describe('regression guard — terminal → non-terminal (the race condition)', () => {
    it('completed → processing: throws 409 with code invalid_status_transition', async () => {
      expect.assertions(3)
      const transaction = makeTransaction('completed')
      const em = makeMockEm(transaction, 1)

      try {
        await runUpdateStatus(em, 'processing')
      } catch (err) {
        const error = err as { status?: number; body?: Record<string, unknown> }
        expect(error.status).toBe(409)
        expect(error.body?.code).toBe('invalid_status_transition')
        expect(em.nativeUpdate).not.toHaveBeenCalled()
      }
    })

    it('completed → failed: throws 409', async () => {
      expect.assertions(2)
      const transaction = makeTransaction('completed')
      const em = makeMockEm(transaction, 1)

      try {
        await runUpdateStatus(em, 'failed')
      } catch (err) {
        const error = err as { status?: number; body?: Record<string, unknown> }
        expect(error.status).toBe(409)
        expect(em.nativeUpdate).not.toHaveBeenCalled()
      }
    })

    it('expired → processing: throws 409', async () => {
      expect.assertions(2)
      const transaction = makeTransaction('expired')
      const em = makeMockEm(transaction, 1)

      try {
        await runUpdateStatus(em, 'processing')
      } catch (err) {
        const error = err as { status?: number; body?: Record<string, unknown> }
        expect(error.status).toBe(409)
        expect(em.nativeUpdate).not.toHaveBeenCalled()
      }
    })

    it('failed → completed: throws 409', async () => {
      expect.assertions(2)
      const transaction = makeTransaction('failed')
      const em = makeMockEm(transaction, 1)

      try {
        await runUpdateStatus(em, 'completed')
      } catch (err) {
        const error = err as { status?: number; body?: Record<string, unknown> }
        expect(error.status).toBe(409)
        expect(em.nativeUpdate).not.toHaveBeenCalled()
      }
    })
  })

  describe('TOCTOU guard — nativeUpdate returns 0 (concurrent write wins)', () => {
    it('nativeUpdate=0 throws 409 with code concurrent_status_update', async () => {
      expect.assertions(5)
      // Transaction is still processing from our read, but another writer won
      // the race and set status to completed. The post-CAS re-read (refresh:true)
      // should return the winner's status, not the stale identity-mapped value.
      const transaction = makeTransaction('processing')
      const em = makeMockEm(transaction, 0, 'completed')

      try {
        await runUpdateStatus(em, 'completed')
      } catch (err) {
        const error = err as { status?: number; body?: Record<string, unknown> }
        expect(error.status).toBe(409)
        expect(error.body?.code).toBe('concurrent_status_update')
        expect(error.body?.expectedStatus).toBe('processing')
        // currentStatus must reflect the winning writer's value, not the stale snapshot
        expect(error.body?.currentStatus).toBe('completed')
        // The terminal event must NOT be emitted when the update was a no-op
        expect(emitCheckoutEvent).not.toHaveBeenCalledWith(
          'checkout.transaction.completed',
          expect.any(Object),
        )
      }
    })

    it('nativeUpdate=0 does NOT emit any event', async () => {
      expect.assertions(1)
      const transaction = makeTransaction('processing')
      const em = makeMockEm(transaction, 0)

      try {
        await runUpdateStatus(em, 'completed')
      } catch {
        // Expected 409 — assert no events were emitted
        expect(emitCheckoutEvent).not.toHaveBeenCalled()
      }
    })
  })

  describe('same-state transitions (idempotency support)', () => {
    it('processing → processing: succeeds and calls nativeUpdate', async () => {
      const transaction = makeTransaction('processing')
      const em = makeMockEm(transaction, 1)

      await runUpdateStatus(em, 'processing')

      expect(em.nativeUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: 'processing' }),
        expect.objectContaining({ status: 'processing' }),
      )
    })

    it('completed → completed: succeeds and calls nativeUpdate', async () => {
      const transaction = makeTransaction('completed')
      const em = makeMockEm(transaction, 1)

      await runUpdateStatus(em, 'completed')

      expect(em.nativeUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: 'completed' }),
        expect.objectContaining({ status: 'completed' }),
      )
    })

    it('completed → completed: does NOT re-emit checkout.transaction.completed (idempotent redelivery guard)', async () => {
      const transaction = makeTransaction('completed')
      const em = makeMockEm(transaction, 1)

      await runUpdateStatus(em, 'completed')

      expect(emitCheckoutEvent).not.toHaveBeenCalledWith(
        'checkout.transaction.completed',
        expect.any(Object),
      )
    })

    it('authorized → captured (both → completed): CAS succeeds but terminal event is NOT re-emitted', async () => {
      // Both payment_gateways.payment.authorized and .captured map to 'completed'.
      // The second delivery (captured) finds the transaction already completed;
      // the CAS still succeeds (same-state), but checkout.transaction.completed
      // must NOT fire a second time so the customer does not receive a duplicate notification.
      const transaction = makeTransaction('completed')
      const em = makeMockEm(transaction, 1)

      await runUpdateStatus(em, 'completed')

      expect(em.nativeUpdate).toHaveBeenCalledTimes(1)
      expect(emitCheckoutEvent).not.toHaveBeenCalledWith(
        'checkout.transaction.completed',
        expect.any(Object),
      )
    })
  })
})

describe('updateTransactionStatusCommand — pay-link usage counters', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('processing → completed releases the reservation and counts the completion with one relative UPDATE', async () => {
    const em = makeMockEm(makeTransaction('processing'), 1)

    await runUpdateStatus(em, 'completed')

    const calls = linkCounterUpdateCalls(em)
    expect(calls).toHaveLength(1)
    const [sql, params] = calls[0] as [string, unknown[]]
    expect(sql).toMatch(/active_reservation_count = GREATEST\(active_reservation_count - 1, 0\)/)
    expect(sql).toMatch(/completion_count = completion_count \+ \?/)
    expect(sql).toMatch(/is_locked = GREATEST\(active_reservation_count - 1, 0\) > 0/)
    expect(sql).toMatch(/organization_id = \?/)
    expect(sql).toMatch(/tenant_id = \?/)
    expect(sql).toMatch(/deleted_at IS NULL/)
    expect(params).toEqual([1, LINK_ID, ORG_ID, TENANT_ID])
  })

  it.each(['failed', 'cancelled', 'expired'] as const)(
    'processing → %s releases the reservation without counting a completion',
    async (status) => {
      const em = makeMockEm(makeTransaction('processing'), 1, undefined, {
        released: [{ completion_count: 0, max_completions: 1 }],
      })

      await runUpdateStatus(em, status)

      const calls = linkCounterUpdateCalls(em)
      expect(calls).toHaveLength(1)
      expect((calls[0] as [string, unknown[]])[1]).toEqual([0, LINK_ID, ORG_ID, TENANT_ID])
      expect(emitCheckoutEvent).not.toHaveBeenCalledWith('checkout.link.usageLimitReached', expect.any(Object))
    },
  )

  it('never writes counters computed from the link row it read earlier', async () => {
    const em = makeMockEm(makeTransaction('processing'), 1, undefined, {
      link: makeLink({ activeReservationCount: 1, completionCount: 0, isLocked: true }),
      released: [{ completion_count: 3, max_completions: null }],
    })

    await runUpdateStatus(em, 'completed')

    expect(em.link).toMatchObject({ activeReservationCount: 1, completionCount: 0, isLocked: true })
  })

  it('reports the usage limit from the committed count, not the stale count it read', async () => {
    const em = makeMockEm(makeTransaction('processing'), 1, undefined, {
      link: makeLink({ completionCount: 0, maxCompletions: 2 }),
      released: [{ completion_count: 2, max_completions: 2 }],
    })

    await runUpdateStatus(em, 'completed')

    expect(emitCheckoutEvent).toHaveBeenCalledWith('checkout.link.usageLimitReached', {
      id: LINK_ID,
      slug: 'test-link',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
  })

  it('reports the usage limit only for the completion that reaches it', async () => {
    const em = makeMockEm(makeTransaction('processing'), 1, undefined, {
      link: makeLink({ completionCount: 2, maxCompletions: 2 }),
      released: [{ completion_count: 3, max_completions: 2 }],
    })

    await runUpdateStatus(em, 'completed')

    expect(emitCheckoutEvent).toHaveBeenCalledWith('checkout.transaction.completed', expect.any(Object))
    expect(emitCheckoutEvent).not.toHaveBeenCalledWith('checkout.link.usageLimitReached', expect.any(Object))
  })

  it('fails with 404 and emits nothing when the link row is gone by the time the reservation is released', async () => {
    const em = makeMockEm(makeTransaction('processing'), 1, undefined, { released: [] })

    await expect(runUpdateStatus(em, 'completed')).rejects.toMatchObject({ status: 404 })
    expect(emitCheckoutEvent).not.toHaveBeenCalled()
  })

  it('does not touch the counters on a same-status redelivery or a non-terminal transition', async () => {
    const redelivery = makeMockEm(makeTransaction('completed'), 1)
    await runUpdateStatus(redelivery, 'completed')
    expect(linkCounterUpdateCalls(redelivery)).toHaveLength(0)

    const nonTerminal = makeMockEm(makeTransaction('pending'), 1)
    await runUpdateStatus(nonTerminal, 'processing')
    expect(linkCounterUpdateCalls(nonTerminal)).toHaveLength(0)
  })
})
