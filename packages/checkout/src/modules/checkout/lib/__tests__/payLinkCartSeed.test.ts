/** @jest-environment node */

// Session creation is anonymous, so it only probes link capacity read-only; the
// compare-and-swap slot reservation (`reserveCheckoutLinkSlot`) is claimed when submit
// starts. These tests pin both the non-consuming probe and the slot release SQL.

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

function makeFakeEm(options: { available?: Array<{ id: string }> } = {}) {
  const available = options.available ?? [{ id: LINK_ID }]
  const execute = jest.fn(async (sql: string) => (sql.includes('SELECT id') ? available : []))
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

describe('seedCartFromCheckoutLink — session creation never holds scarce completion capacity', () => {
  beforeEach(() => jest.clearAllMocks())

  it('only probes capacity with a read-only query and never increments the reservation counter', async () => {
    const { em, execute } = makeFakeEm()
    const bus = makeFakeCommandBus()
    const container = { resolve: () => undefined }

    await seedCartFromCheckoutLink({ em: em as any, container, commandBus: bus as any, link: makeLink(), request: null })

    expect(reservationCalls(execute)).toHaveLength(0)
    const probes = execute.mock.calls.filter(([sql]) => typeof sql === 'string' && sql.includes('SELECT id'))
    expect(probes).toHaveLength(1)
    const [sql, params] = probes[0] as [string, unknown[]]
    expect(sql).toMatch(/completion_count \+ active_reservation_count < max_completions/)
    expect(params).toEqual([LINK_ID, ORG_ID, TENANT_ID])
  })

  it('an abandoned anonymous session cannot monopolize a maxCompletions:1 link — repeated seeding never consumes the slot', async () => {
    const { em, execute } = makeFakeEm()
    const bus = makeFakeCommandBus()
    const container = { resolve: () => undefined }
    const link = makeLink({ maxCompletions: 1 })

    await seedCartFromCheckoutLink({ em: em as any, container, commandBus: bus as any, link, request: null })
    await seedCartFromCheckoutLink({ em: em as any, container, commandBus: bus as any, link, request: null })

    expect(reservationCalls(execute)).toHaveLength(0)
  })

  it('422s with checkout_link_unavailable when no capacity is left — never seeds a cart', async () => {
    const { em } = makeFakeEm({ available: [] })
    const bus = makeFakeCommandBus()
    const container = { resolve: () => undefined }

    await expect(
      seedCartFromCheckoutLink({ em: em as any, container, commandBus: bus as any, link: makeLink({ maxCompletions: 1 }), request: null }),
    ).rejects.toMatchObject({ status: 422, body: expect.objectContaining({ code: 'checkout_link_unavailable' }) })

    expect(bus.calls).toHaveLength(0)
  })

  it('does not touch the link counters when cart creation fails downstream', async () => {
    const { em, execute } = makeFakeEm()
    const bus = makeFakeCommandBus({ failOn: 'cart.lines.add' })
    const container = { resolve: () => undefined }

    await expect(
      seedCartFromCheckoutLink({ em: em as any, container, commandBus: bus as any, link: makeLink(), request: null }),
    ).rejects.toThrow('simulated failure')

    expect(reservationCalls(execute)).toHaveLength(0)
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
