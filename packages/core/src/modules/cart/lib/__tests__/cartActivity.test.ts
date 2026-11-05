import type { EntityManager } from '@mikro-orm/postgresql'
import { Cart } from '../../data/entities'
import { recordBasketMutationActivity, resolveCartExpiresAt } from '../cartActivity'

type CartRow = Record<string, unknown>

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = new Date('2026-10-23T12:00:00.000Z')
const EARLIER = new Date('2026-10-20T08:00:00.000Z')

function makeCart(overrides: CartRow = {}): Cart {
  return {
    id: 'cart-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    kind: 'basket',
    status: 'active',
    customerId: null,
    lastActivityAt: EARLIER,
    resolvedAt: null,
    expiresAt: new Date('2026-10-25T08:00:00.000Z'),
    updatedAt: EARLIER,
    ...overrides,
  } as unknown as Cart
}

function makeEm(stored: Cart | null) {
  const nativeUpdate = jest.fn(async (_entity: unknown, where: CartRow, data: CartRow) => {
    if (!stored) return 0
    const row = stored as unknown as CartRow
    const matches = Object.entries(where).every(([key, value]) => row[key] === value)
    if (!matches) return 0
    Object.assign(row, data)
    return 1
  })
  return { em: { nativeUpdate } as unknown as EntityManager, nativeUpdate }
}

describe('resolveCartExpiresAt', () => {
  it('gives a guest 7 days and an identified buyer 30 days', () => {
    expect(resolveCartExpiresAt(NOW, null).getTime()).toBe(NOW.getTime() + 7 * DAY_MS)
    expect(resolveCartExpiresAt(NOW, 'customer-1').getTime()).toBe(NOW.getTime() + 30 * DAY_MS)
  })
})

describe('recordBasketMutationActivity', () => {
  it('reactivates an abandoned guest basket and extends its expiry', async () => {
    const cart = makeCart({ status: 'abandoned', resolvedAt: EARLIER })
    const { em, nativeUpdate } = makeEm(makeCart({ status: 'abandoned', resolvedAt: EARLIER }))

    await recordBasketMutationActivity(em, cart, NOW)

    expect(nativeUpdate).toHaveBeenCalledWith(
      Cart,
      expect.objectContaining({ id: 'cart-1', kind: 'basket', status: 'abandoned' }),
      expect.objectContaining({ status: 'active', resolvedAt: null, lastActivityAt: NOW }),
    )
    expect(cart.status).toBe('active')
    expect(cart.resolvedAt).toBeNull()
    expect(cart.lastActivityAt).toBe(NOW)
    expect(cart.expiresAt.getTime()).toBe(NOW.getTime() + 7 * DAY_MS)
  })

  it('extends an abandoned identified buyer basket by 30 days', async () => {
    const cart = makeCart({ status: 'abandoned', customerId: 'customer-1' })
    const { em } = makeEm(makeCart({ status: 'abandoned', customerId: 'customer-1' }))

    await recordBasketMutationActivity(em, cart, NOW)

    expect(cart.expiresAt.getTime()).toBe(NOW.getTime() + 30 * DAY_MS)
  })

  it('only bumps lastActivityAt on an active basket', async () => {
    const originalExpiry = new Date('2026-10-25T08:00:00.000Z')
    const cart = makeCart({ expiresAt: originalExpiry })
    const { em, nativeUpdate } = makeEm(makeCart())

    await recordBasketMutationActivity(em, cart, NOW)

    expect(nativeUpdate).toHaveBeenCalledWith(
      Cart,
      expect.objectContaining({ id: 'cart-1', status: 'active' }),
      { lastActivityAt: NOW },
    )
    expect(cart.lastActivityAt).toBe(NOW)
    expect(cart.expiresAt).toBe(originalExpiry)
    expect(cart.status).toBe('active')
  })

  it.each(['merged', 'expired', 'converted', 'locked'])('leaves a %s basket untouched', async (status) => {
    const cart = makeCart({ status })
    const { em, nativeUpdate } = makeEm(makeCart({ status }))

    await recordBasketMutationActivity(em, cart, NOW)

    expect(nativeUpdate).not.toHaveBeenCalled()
    expect(cart.status).toBe(status)
    expect(cart.lastActivityAt).toBe(EARLIER)
  })

  it('never reactivates an abandoned proposal', async () => {
    const cart = makeCart({ kind: 'proposal', status: 'abandoned' })
    const { em, nativeUpdate } = makeEm(makeCart({ kind: 'proposal', status: 'abandoned' }))

    await recordBasketMutationActivity(em, cart, NOW)

    expect(nativeUpdate).not.toHaveBeenCalled()
    expect(cart.status).toBe('abandoned')
  })

  it('keeps the in-memory cart unchanged when a concurrent write already moved the row', async () => {
    const cart = makeCart({ status: 'abandoned' })
    const { em } = makeEm(makeCart({ status: 'merged' }))

    await recordBasketMutationActivity(em, cart, NOW)

    expect(cart.status).toBe('abandoned')
    expect(cart.lastActivityAt).toBe(EARLIER)
  })
})
