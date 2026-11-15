jest.mock('@open-mercato/shared/lib/query/engine', () => ({
  resolveEntityTableName: jest.fn((_em: unknown, entityType: string) =>
    entityType.startsWith('feature_toggles:') ? 'feature_toggles' : 'customer_people'),
}))
jest.mock('../../lib/auto-indexing', () => ({
  resolveAutoIndexingEnabled: jest.fn().mockResolvedValue(false),
}))

import vectorUpsert from '../vector_upsert'
import vectorDelete from '../vector_delete'
import fulltextUpsert from '../fulltext_upsert'

/**
 * The unscoped-record lookup reads the scope of a record from its entity table. It must
 * run on a fork so an error can never poison a caller's transaction, and it must only
 * select the scope columns the table actually has: global tables such as
 * `feature_toggles` have neither `organization_id` nor `tenant_id`, and selecting them
 * logged `column "organization_id" does not exist` for every toggle seeded during init.
 */
const metadata = [
  { tableName: 'feature_toggles', properties: { id: { fieldNames: ['id'] } } },
  {
    tableName: 'customer_people',
    properties: {
      id: { fieldNames: ['id'] },
      organizationId: { fieldNames: ['organization_id'] },
      tenantId: { fieldNames: ['tenant_id'] },
    },
  },
]

function buildContext() {
  const executeTakeFirst = jest.fn().mockResolvedValue({ organization_id: 'org-1', tenant_id: 'tenant-1' })
  const where = jest.fn(() => ({ executeTakeFirst }))
  const select = jest.fn(() => ({ where }))
  const selectFrom = jest.fn(() => ({ select }))
  const forkKysely = { selectFrom }
  const forkEm = {
    getKysely: jest.fn(() => forkKysely),
    getMetadata: jest.fn(() => ({ getAll: () => metadata })),
  }
  const requestEm = { getKysely: jest.fn(), fork: jest.fn(() => forkEm) }
  const ctx = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return requestEm
      throw new Error(`[internal] not registered: ${name}`)
    }),
  }
  return { ctx, requestEm, forkEm, selectFrom, select, executeTakeFirst }
}

type SubscriberHandler = (payload: Record<string, unknown>, ctx: unknown) => Promise<void>

const handlers: Array<[string, SubscriberHandler, string]> = [
  ['query_index.vectorize_one', vectorUpsert as SubscriberHandler, 'entityType'],
  ['query_index.delete_one', vectorDelete as SubscriberHandler, 'entityType'],
  ['search.index_record', fulltextUpsert as SubscriberHandler, 'entityId'],
]

describe('search subscriber scope lookup', () => {
  it.each(handlers)('%s skips the row lookup for a table without scope columns', async (_event, handler, entityKey) => {
    const { ctx, requestEm, selectFrom } = buildContext()

    await expect(handler({ [entityKey]: 'feature_toggles:feature_toggle', recordId: 'r1', tenantId: null, organizationId: null }, ctx))
      .resolves.toBeUndefined()

    expect(requestEm.getKysely).not.toHaveBeenCalled()
    expect(selectFrom).not.toHaveBeenCalled()
  })

  it.each(handlers)('%s reads scope columns on a fork for scoped tables', async (_event, handler, entityKey) => {
    const { ctx, requestEm, forkEm, selectFrom, select, executeTakeFirst } = buildContext()

    await expect(handler({ [entityKey]: 'customers:customer_person', recordId: 'r1', tenantId: null, organizationId: null }, ctx))
      .resolves.toBeUndefined()

    expect(requestEm.getKysely).not.toHaveBeenCalled()
    expect(requestEm.fork).toHaveBeenCalledTimes(1)
    expect(forkEm.getKysely).toHaveBeenCalled()
    expect(selectFrom).toHaveBeenCalledWith('customer_people')
    expect(select).toHaveBeenCalledWith(['organization_id', 'tenant_id'])
    expect(executeTakeFirst).toHaveBeenCalledTimes(1)
  })
})
