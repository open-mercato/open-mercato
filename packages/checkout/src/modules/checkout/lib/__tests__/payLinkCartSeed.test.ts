/** @jest-environment node */

// Finding 5: `maxCompletions` used to be checked only at seed time (a plain read-then-
// compare), with nothing ever incrementing `active_reservation_count` for a session-backed
// `simple_checkout` link — so a single-use pay link could seed unlimited concurrent carts.
// These tests pin the atomic compare-and-swap reserve (mirroring
// `commands/transactions.ts#createTransactionCommand`'s own pattern) and its release.

jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerAuth', () => ({
  getCustomerAuthFromRequest: jest.fn(async () => null),
}))

import { seedCartFromCheckoutLink, releaseCheckoutLinkSlot } from '../payLinkCartSeed'
import type { CheckoutLink, CheckoutLinkCartTemplate } from '../../data/entities'

const LINK_ID = 'link-1'
const ORG_ID = 'org-1'
const TENANT_ID = 'tenant-1'

function makeLink(overrides: Partial<CheckoutLink> = {}): CheckoutLink {
  return {
    id: LINK_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    slug: 'donate',
    status: 'active',
    maxCompletions: null,
    completionCount: 0,
    activeReservationCount: 0,
    passwordHash: null,
    deletedAt: null,
    ...overrides,
  } as CheckoutLink

}

function makeTemplateLine(overrides: Partial<CheckoutLinkCartTemplate> = {}): CheckoutLinkCartTemplate {
  return {
    id: 'template-line-1',
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    linkId: LINK_ID,
    productId: 'product-1',
    variantId: null,
    quantity: 1,
    unitPriceOverride: null,
    currencyCode: 'USD',
    sortOrder: 0,
    deletedAt: null,
    ...overrides,
  } as CheckoutLinkCartTemplate
}

function reservationCalls(mock: jest.Mock) {
  return mock.mock.calls.filter(([sql]) => typeof sql === 'string' && sql.includes('UPDATE checkout_links'))
}

function makeFakeEm(options: { reserved?: Array<{ active_reservation_count: number }> } = {}) {
  const reserved = options.reserved ?? [{ active_reservation_count: 1 }]
  const execute = jest.fn(async (sql: string) => (
    sql.includes('active_reservation_count = active_reservation_count + 1') ? reserved : []
  ))
  const em = {
    find: jest.fn(async () => [makeTemplateLine()]),
    execute,
  }
  return { em, execute }
}

function makeFakeCommandBus(overrides: { failOn?: string } = {}) {
  const calls: Array<{ id: string; input: unknown }> = []
  const execute = jest.fn(async (id: string, options: { input: unknown }) => {
    calls.push({ id, input: options.input })
    if (overrides.failOn === id) throw new Error(`[internal] simulated failure for ${id}`)
    if (id === 'cart.create') return { result: { cartId: 'cart-1' } }
    if (id === 'cart.lines.add') return { result: { status: 'added' } }
    throw new Error(`Unexpected command id: ${id}`)
  })
  return { execute: execute as unknown, calls }
}

describe('seedCartFromCheckoutLink — atomic usage-slot reservation (Finding 5)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('reserves the slot through the SAME compare-and-swap SQL as createTransactionCommand, before seeding the cart', async () => {
    const { em, execute } = makeFakeEm()
    const bus = makeFakeCommandBus()
    const container = { resolve: () => undefined }

    await seedCartFromCheckoutLink({ em: em as any, container, commandBus: bus as any, link: makeLink(), request: null })

    const calls = reservationCalls(execute)
    expect(calls).toHaveLength(1)
    const [sql, params] = calls[0] as [string, unknown[]]
    expect(sql).toMatch(/active_reservation_count = active_reservation_count \+ 1/)
    expect(sql).toMatch(/completion_count \+ active_reservation_count < max_completions/)
    expect(params).toEqual([LINK_ID, ORG_ID, TENANT_ID])
  })

  it('422s with checkout_link_unavailable when the atomic reservation finds no slot left — never seeds a cart', async () => {
    const { em } = makeFakeEm({ reserved: [] })
    const bus = makeFakeCommandBus()
    const container = { resolve: () => undefined }

    await expect(
      seedCartFromCheckoutLink({ em: em as any, container, commandBus: bus as any, link: makeLink({ maxCompletions: 1 }), request: null }),
    ).rejects.toMatchObject({ status: 422, body: expect.objectContaining({ code: 'checkout_link_unavailable' }) })

    expect(bus.calls).toHaveLength(0)
  })

  it('releases the just-claimed slot when cart creation fails downstream, instead of leaking a permanently-reserved slot', async () => {
    const { em, execute } = makeFakeEm()
    const bus = makeFakeCommandBus({ failOn: 'cart.lines.add' })
    const container = { resolve: () => undefined }

    await expect(
      seedCartFromCheckoutLink({ em: em as any, container, commandBus: bus as any, link: makeLink(), request: null }),
    ).rejects.toThrow('simulated failure')

    const calls = reservationCalls(execute)
    expect(calls).toHaveLength(2)
    const [releaseSql, releaseParams] = calls[1] as [string, unknown[]]
    expect(releaseSql).toMatch(/GREATEST\(active_reservation_count - 1, 0\)/)
    // `completed: false` passes a 0 completion delta — the slot is freed, not consumed.
    expect(releaseParams).toEqual([0, LINK_ID, ORG_ID, TENANT_ID])
  })
})

describe('releaseCheckoutLinkSlot', () => {
  it('passes a 1 completion delta when the outcome completed, 0 when it did not', async () => {
    const execute = jest.fn(async () => [])
    const em = { execute } as any

    await releaseCheckoutLinkSlot(em, { tenantId: TENANT_ID, organizationId: ORG_ID }, LINK_ID, { completed: true })
    expect(execute.mock.calls[0][1]).toEqual([1, LINK_ID, ORG_ID, TENANT_ID])

    await releaseCheckoutLinkSlot(em, { tenantId: TENANT_ID, organizationId: ORG_ID }, LINK_ID, { completed: false })
    expect(execute.mock.calls[1][1]).toEqual([0, LINK_ID, ORG_ID, TENANT_ID])
  })
})
