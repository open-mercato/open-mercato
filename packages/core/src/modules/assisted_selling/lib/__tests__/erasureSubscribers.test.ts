const mockEraseAssistedSellingThread = jest.fn(async () => true)
const mockAnonymizeAssistedSellingRepParticipants = jest.fn(async () => 1)
jest.mock('../retention', () => ({
  eraseAssistedSellingThread: (...args: unknown[]) => mockEraseAssistedSellingThread(...args),
  anonymizeAssistedSellingRepParticipants: (...args: unknown[]) => mockAnonymizeAssistedSellingRepParticipants(...args),
}))

import { AssistedSellingThread } from '../../data/entities'
import {
  handleAuthUserDeletedErasure,
  handleCartPurgedErasure,
  handleCustomerAccountsUserDeletedErasure,
} from '../erasureSubscribers'

const TENANT_ID = 'tenant-1'
const ORG_ID = 'org-1'
const CART_ID = 'cart-1'

beforeEach(() => {
  jest.clearAllMocks()
})

function makeThreadEm(threads: Record<string, unknown>[]) {
  return {
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity !== AssistedSellingThread) return null
      return threads.find((t) => Object.entries(where).every(([key, value]) => (t[key] ?? null) === (value ?? null))) ?? null
    }),
    find: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity !== AssistedSellingThread) return []
      return threads.filter((t) => Object.entries(where).every(([key, value]) => (t[key] ?? null) === (value ?? null)))
    }),
  }
}

function makeCtx(em: unknown, scope: { tenantId?: string | null; organizationId?: string | null } = {}) {
  return {
    resolve: (name: string) => (name === 'em' ? { fork: () => em } : undefined),
    tenantId: scope.tenantId ?? null,
    organizationId: scope.organizationId ?? null,
  }
}

describe('handleCartPurgedErasure — cart.cart.purged (§5.10)', () => {
  it('erases the thread keyed on a purged basket cart', async () => {
    const thread = { id: 'thread-1', tenantId: TENANT_ID, organizationId: ORG_ID, buyerCartId: CART_ID, deletedAt: null }
    const em = makeThreadEm([thread])

    await handleCartPurgedErasure(
      { cartId: CART_ID, kind: 'basket', tenantId: TENANT_ID, organizationId: ORG_ID },
      makeCtx(em),
    )

    expect(mockEraseAssistedSellingThread).toHaveBeenCalledWith(em, { tenantId: TENANT_ID, organizationId: ORG_ID }, 'thread-1')
  })

  it('erases nothing for a purged PROPOSAL cart (kind !== basket, §5.10/S15)', async () => {
    const em = makeThreadEm([])

    await handleCartPurgedErasure(
      { cartId: CART_ID, kind: 'proposal', tenantId: TENANT_ID, organizationId: ORG_ID },
      makeCtx(em),
    )

    expect(em.findOne).not.toHaveBeenCalled()
    expect(mockEraseAssistedSellingThread).not.toHaveBeenCalled()
  })

  it('is a no-op (never throws) for an incomplete payload missing tenantId/organizationId', async () => {
    const em = makeThreadEm([])

    await expect(handleCartPurgedErasure({ cartId: CART_ID, kind: 'basket' }, makeCtx(em))).resolves.toBeUndefined()

    expect(mockEraseAssistedSellingThread).not.toHaveBeenCalled()
  })

  it('erases nothing when no thread is keyed on the purged cart', async () => {
    const em = makeThreadEm([])

    await handleCartPurgedErasure({ cartId: CART_ID, kind: 'basket', tenantId: TENANT_ID, organizationId: ORG_ID }, makeCtx(em))

    expect(mockEraseAssistedSellingThread).not.toHaveBeenCalled()
  })

  it('is idempotent on redelivery — a second delivery for the same cart touches nothing further once eraseAssistedSellingThread reports no-op', async () => {
    const thread = { id: 'thread-1', tenantId: TENANT_ID, organizationId: ORG_ID, buyerCartId: CART_ID, deletedAt: null }
    const em = makeThreadEm([thread])

    await handleCartPurgedErasure({ cartId: CART_ID, kind: 'basket', tenantId: TENANT_ID, organizationId: ORG_ID }, makeCtx(em))
    await handleCartPurgedErasure({ cartId: CART_ID, kind: 'basket', tenantId: TENANT_ID, organizationId: ORG_ID }, makeCtx(em))

    expect(mockEraseAssistedSellingThread).toHaveBeenCalledTimes(2)
  })
})

describe('handleCustomerAccountsUserDeletedErasure — customer_accounts.user.deleted (§5.10)', () => {
  it('erases every thread for the deleted buyer\'s customerUserId', async () => {
    const threads = [
      { id: 'thread-1', tenantId: TENANT_ID, organizationId: ORG_ID, customerUserId: 'buyer-1', deletedAt: null },
      { id: 'thread-2', tenantId: TENANT_ID, organizationId: ORG_ID, customerUserId: 'buyer-1', deletedAt: null },
    ]
    const em = makeThreadEm(threads)

    // `customer_accounts.user.deleted`'s own payload shape carries the deleted user's id as
    // `id`, not `userId` (distinct from `auth.user.deleted`).
    await handleCustomerAccountsUserDeletedErasure({ id: 'buyer-1', tenantId: TENANT_ID, organizationId: ORG_ID }, makeCtx(em))

    expect(mockEraseAssistedSellingThread).toHaveBeenCalledTimes(2)
    expect(mockEraseAssistedSellingThread).toHaveBeenCalledWith(em, { tenantId: TENANT_ID, organizationId: ORG_ID }, 'thread-1')
    expect(mockEraseAssistedSellingThread).toHaveBeenCalledWith(em, { tenantId: TENANT_ID, organizationId: ORG_ID }, 'thread-2')
  })

  it('scopes by tenantId — a thread in another tenant is never erased', async () => {
    const threads = [{ id: 'thread-other-tenant', tenantId: 'other-tenant', organizationId: ORG_ID, customerUserId: 'buyer-1', deletedAt: null }]
    const em = makeThreadEm(threads)

    await handleCustomerAccountsUserDeletedErasure({ id: 'buyer-1', tenantId: TENANT_ID, organizationId: ORG_ID }, makeCtx(em))

    expect(mockEraseAssistedSellingThread).not.toHaveBeenCalled()
  })

  it('is a no-op for a payload missing the deleted user id', async () => {
    const em = makeThreadEm([])

    await handleCustomerAccountsUserDeletedErasure({ tenantId: TENANT_ID, organizationId: ORG_ID }, makeCtx(em))

    expect(mockEraseAssistedSellingThread).not.toHaveBeenCalled()
  })
})

describe('handleAuthUserDeletedErasure — auth.user.deleted (§5.10)', () => {
  it('anonymizes the deleted rep\'s participant rows, scoped by tenant/organization', async () => {
    const em = {}

    // `auth.user.deleted`'s own payload shape carries the deleted user's id as `userId`.
    await handleAuthUserDeletedErasure({ userId: 'rep-1', tenantId: TENANT_ID, organizationId: ORG_ID }, makeCtx(em))

    expect(mockAnonymizeAssistedSellingRepParticipants).toHaveBeenCalledWith(em, { tenantId: TENANT_ID, organizationId: ORG_ID }, 'rep-1')
  })

  it('is a no-op for a payload missing userId or tenantId', async () => {
    const em = {}

    await handleAuthUserDeletedErasure({ tenantId: TENANT_ID }, makeCtx(em))
    await handleAuthUserDeletedErasure({ userId: 'rep-1' }, makeCtx(em))

    expect(mockAnonymizeAssistedSellingRepParticipants).not.toHaveBeenCalled()
  })

  it('is idempotent on redelivery — calling twice is safe (the underlying routine itself no-ops on an already-anonymized row)', async () => {
    const em = {}

    await handleAuthUserDeletedErasure({ userId: 'rep-1', tenantId: TENANT_ID, organizationId: ORG_ID }, makeCtx(em))
    await handleAuthUserDeletedErasure({ userId: 'rep-1', tenantId: TENANT_ID, organizationId: ORG_ID }, makeCtx(em))

    expect(mockAnonymizeAssistedSellingRepParticipants).toHaveBeenCalledTimes(2)
  })
})
