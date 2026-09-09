jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: async (
    em: { find: (...args: unknown[]) => Promise<unknown[]> },
    entityName: unknown,
    where: unknown,
    options: unknown,
  ) => em.find(entityName, where, options),
  findOneWithDecryption: async (em: { findOne: (...args: unknown[]) => Promise<unknown> }) => em.findOne(),
  findAndCountWithDecryption: async () => [[], 0],
}))

import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { CUSTOMER_EXAMPLES, seedCustomerExamples } from '../cli'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'

const SENTINEL = 'SEED_PROCEEDED_PAST_GUARD'

const exampleDealTitle = (() => {
  for (const company of CUSTOMER_EXAMPLES) {
    for (const deal of company.deals ?? []) {
      if (typeof deal.title === 'string') return deal.title
    }
  }
  throw new Error('fixture drift: CUSTOMER_EXAMPLES contains no deal titles')
})()

type FindOptions = { limit?: number; offset?: number }
type FindCall = { entityName: unknown; where: unknown; options: FindOptions }

function makeEm(existingDeals: Array<{ title: string }>) {
  const findCalls: FindCall[] = []
  const beyondGuard = () => {
    throw new Error(SENTINEL)
  }
  const em = {
    count: async () => 0,
    find: async (entityName: unknown, where: unknown, options: FindOptions = {}) => {
      findCalls.push({ entityName, where, options })
      const offset = options.offset ?? 0
      const limit = options.limit ?? existingDeals.length
      return existingDeals.slice(offset, offset + limit)
    },
    findOne: beyondGuard,
    create: beyondGuard,
    persist: beyondGuard,
    persistAndFlush: beyondGuard,
    flush: beyondGuard,
    getConnection: beyondGuard,
    fork: beyondGuard,
  }
  return { em: em as unknown as EntityManager, findCalls }
}

const container = {
  resolve: () => {
    throw new Error(SENTINEL)
  },
} as unknown as AppContainer

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

  it('checks deals in bounded batches until an example title is found', async () => {
    const nonExampleDeals = Array.from({ length: 100 }, (_, index) => ({ title: `Operator deal ${index}` }))
    const { em, findCalls } = makeEm([...nonExampleDeals, { title: exampleDealTitle }])

    const seeded = await seedCustomerExamples(em, container, {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })

    expect(seeded).toBe(false)
    expect(findCalls).toHaveLength(2)
    expect(findCalls.map(({ options }) => options.offset)).toEqual([0, 100])
    expect(findCalls.every(({ options }) => options.limit === 100)).toBe(true)
  })
})
