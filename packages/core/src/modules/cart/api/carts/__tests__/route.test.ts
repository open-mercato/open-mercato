jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn((opts: unknown) => ({ opts, GET: jest.fn() })),
}))

const mockFindWithDecryption = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

import type { EntityManager } from '@mikro-orm/postgresql'
import { cartAdminListCrud, cartAdminListQuerySchema } from '../route'
import { CartLine } from '../../../data/entities'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'

// Step 2.10 (K6/§10.2) — this suite exercises the list route's `buildFilters`/`afterList`
// logic directly against the captured `makeCrudRoute` options, the same pattern
// `customer_groups/api/customer-groups/credit-accounts/__tests__/creditAccountCreate.test.ts`
// already uses for its own hooks — never standing up the real factory/HTTP layer, which
// `makeCrudRoute` itself already has its own test suite for.

type CartAdminListOpts = {
  list: {
    buildFilters: (query: Record<string, unknown>) => Record<string, unknown>
  }
  hooks: {
    afterList: (res: unknown, ctx: unknown) => Promise<void>
  }
}

const opts = (cartAdminListCrud as unknown as { opts: CartAdminListOpts }).opts

describe('cart admin list — kind filter (K6/§10.2, pinning the proposal seam)', () => {
  it('defaults kind to basket', () => {
    const parsed = cartAdminListQuerySchema.parse({})
    expect(parsed.kind).toBe('basket')
  })

  it('rejects any kind other than basket (the §7a seam stays unreachable from this list)', () => {
    expect(cartAdminListQuerySchema.safeParse({ kind: 'proposal' }).success).toBe(false)
  })

  it('rejects a pageSize above 100 (root AGENTS.md)', () => {
    expect(cartAdminListQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false)
  })
})

describe('cart admin list — buildFilters', () => {
  it('always filters kind = basket, and narrows by status/channel/storeId/customerId when supplied', () => {
    const filters = opts.list.buildFilters(
      cartAdminListQuerySchema.parse({
        status: 'active',
        channel: 'storefront',
        storeId: '11111111-1111-4111-8111-111111111111',
        customerId: '22222222-2222-4222-8222-222222222222',
      }),
    )
    expect(filters).toMatchObject({
      kind: { $eq: 'basket' },
      status: { $eq: 'active' },
      channel: { $eq: 'storefront' },
      store_id: { $eq: '11111111-1111-4111-8111-111111111111' },
      customer_id: { $eq: '22222222-2222-4222-8222-222222222222' },
    })
  })

  it('applies the requiresApproval boolean filter', () => {
    const filters = opts.list.buildFilters(cartAdminListQuerySchema.parse({ requiresApproval: 'true' }))
    expect(filters.requires_approval).toEqual({ $eq: true })
  })

  it('builds a lastActivity range from lastActivityFrom/lastActivityTo', () => {
    const filters = opts.list.buildFilters(
      cartAdminListQuerySchema.parse({ lastActivityFrom: '2026-01-01', lastActivityTo: '2026-01-31' }),
    )
    expect(filters.last_activity_at).toEqual({ $gte: '2026-01-01', $lte: '2026-01-31' })
  })

  it('omits every optional filter when the query names none of them', () => {
    const filters = opts.list.buildFilters(cartAdminListQuerySchema.parse({}))
    expect(filters).toEqual({ kind: { $eq: 'basket' } })
  })
})

describe('cart admin list — afterList lineCount enrichment (§10.2 row shape)', () => {
  it('batches one CartLine query across every row of the page and attaches lineCount per row', async () => {
    const lines = [
      { cartId: 'cart-1', deletedAt: null },
      { cartId: 'cart-1', deletedAt: null },
      { cartId: 'cart-2', deletedAt: null },
    ]
    const find = jest.fn(async (entity: unknown) => (entity === CartLine ? lines : []))
    const em = { fork: jest.fn(() => ({ find })) } as unknown as EntityManager
    const ctx = { container: { resolve: (name: string) => (name === 'em' ? em : undefined) } }

    const items: Array<Record<string, unknown>> = [{ id: 'cart-1' }, { id: 'cart-2' }, { id: 'cart-3' }]
    await opts.hooks.afterList({ items }, ctx)

    expect(find).toHaveBeenCalledTimes(1)
    expect(items[0].lineCount).toBe(2)
    expect(items[1].lineCount).toBe(1)
    expect(items[2].lineCount).toBe(0)
  })

  it('is a no-op for an empty page', async () => {
    const ctx = { container: { resolve: () => undefined } }
    await expect(opts.hooks.afterList({ items: [] }, ctx)).resolves.toBeUndefined()
  })
})

// Regression (bug 16, round-4 QA): the customerName enrichment used a plain `em.find`
// against `CustomerEntity.displayName`, an encrypted column, so admins saw ciphertext
// instead of a name. Must go through `findWithDecryption`, scoped to tenant+organization.
describe('cart admin list — afterList customerName enrichment (decryption)', () => {
  beforeEach(() => {
    mockFindWithDecryption.mockReset()
  })

  it('resolves customerName via findWithDecryption, scoped to the caller\'s tenant and organization', async () => {
    mockFindWithDecryption.mockResolvedValue([{ id: 'customer-1', displayName: 'Alice Buyer' }])
    const find = jest.fn(async () => [])
    const em = { fork: jest.fn(() => ({ find })) } as unknown as EntityManager
    const ctx = {
      container: { resolve: (name: string) => (name === 'em' ? em : undefined) },
      auth: { tenantId: 'tenant-1', orgId: 'org-1' },
      selectedOrganizationId: 'org-1',
    }

    const items: Array<Record<string, unknown>> = [{ id: 'cart-1', customerId: 'customer-1' }]
    await opts.hooks.afterList({ items }, ctx)

    expect(mockFindWithDecryption).toHaveBeenCalledTimes(1)
    const [, entity, where, , scope] = mockFindWithDecryption.mock.calls[0]
    expect(entity).toBe(CustomerEntity)
    expect(where).toMatchObject({ id: { $in: ['customer-1'] }, tenantId: 'tenant-1', organizationId: 'org-1' })
    expect(scope).toEqual({ tenantId: 'tenant-1', organizationId: 'org-1' })
    expect(items[0].customerName).toBe('Alice Buyer')
  })
})
