// Regression guard: `seedCustomerExamples`'s idempotency check must read deal titles back through
// the decryption-aware helper. `customer_deal.title` is encryption-mapped (see ../encryption.ts), so
// with TENANT_DATA_ENCRYPTION enabled the stored column holds ciphertext — a plaintext
// `title: { $in: [...] }` filter matches nothing, the guard falls through, and every re-run against
// an already-seeded tenant silently duplicates the whole example batch.
//
// The fake EM below encodes exactly that asymmetry: `count()` always returns 0 (what a plaintext
// filter does against ciphertext) while `find()` returns the rows that really exist.

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  // Forward the query through to the fake EM so the test can assert what the guard asked for.
  findWithDecryption: async (
    em: { find: (...args: unknown[]) => Promise<unknown> },
    entityName: unknown,
    where: unknown,
    options: unknown,
  ) => em.find(entityName, where, options),
  findOneWithDecryption: async (em: { findOne: (...args: unknown[]) => Promise<unknown> }) => em.findOne(),
  findAndCountWithDecryption: async () => [[], 0],
}))

import { CUSTOMER_EXAMPLES, seedCustomerExamples } from '../cli'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'

// Thrown by every EM method the seed would only reach *after* the guard declines to short-circuit.
const SENTINEL = 'SEED_PROCEEDED_PAST_GUARD'

const exampleDealTitle = (() => {
  for (const company of CUSTOMER_EXAMPLES) {
    for (const deal of company.deals ?? []) {
      if (typeof deal.title === 'string') return deal.title
    }
  }
  throw new Error('fixture drift: CUSTOMER_EXAMPLES contains no deal titles')
})()

type FindCall = { entityName: unknown; where: unknown }

function makeEm(existingDeals: Array<{ title: string }>) {
  const findCalls: FindCall[] = []
  const beyondGuard = () => {
    throw new Error(SENTINEL)
  }
  const em = {
    // A plaintext equality/$in filter against an encrypted column matches nothing.
    count: async () => 0,
    find: async (entityName: unknown, where: unknown) => {
      findCalls.push({ entityName, where })
      return existingDeals
    },
    findOne: beyondGuard,
    create: beyondGuard,
    persist: beyondGuard,
    persistAndFlush: beyondGuard,
    flush: beyondGuard,
    getConnection: beyondGuard,
    fork: beyondGuard,
  }
  return { em: em as any, findCalls }
}

const container = { resolve: () => { throw new Error(SENTINEL) } } as any

describe('seedCustomerExamples idempotency guard under TENANT_DATA_ENCRYPTION', () => {
  it('declines to re-seed when example deals exist, even though a plaintext count matches nothing', async () => {
    const { em } = makeEm([{ title: exampleDealTitle }])

    const seeded = await seedCustomerExamples(em, container, {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })

    expect(seeded).toBe(false)
  })

  it('scopes the guard to the target tenant and organization', async () => {
    const { em, findCalls } = makeEm([{ title: exampleDealTitle }])

    await seedCustomerExamples(em, container, { tenantId: TENANT_ID, organizationId: ORG_ID })

    expect(findCalls.length).toBeGreaterThan(0)
    expect(findCalls[0].where).toMatchObject({ tenantId: TENANT_ID, organizationId: ORG_ID })
  })

  it('does not short-circuit when the tenant holds no example deals', async () => {
    const { em } = makeEm([])

    // The guard must fall through and let seeding proceed; the fake EM throws as soon as it does.
    await expect(
      seedCustomerExamples(em, container, { tenantId: TENANT_ID, organizationId: ORG_ID }),
    ).rejects.toThrow(SENTINEL)
  })

  it('ignores deals whose titles are not part of the example set', async () => {
    const { em } = makeEm([{ title: 'A deal the operator created themselves' }])

    await expect(
      seedCustomerExamples(em, container, { tenantId: TENANT_ID, organizationId: ORG_ID }),
    ).rejects.toThrow(SENTINEL)
  })
})
