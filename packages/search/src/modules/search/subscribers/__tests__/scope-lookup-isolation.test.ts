jest.mock('@open-mercato/shared/lib/query/engine', () => ({
  resolveEntityTableName: jest.fn(() => 'feature_toggles'),
}))
jest.mock('../../lib/auto-indexing', () => ({
  resolveAutoIndexingEnabled: jest.fn().mockResolvedValue(false),
}))

import vectorUpsert from '../vector_upsert'
import vectorDelete from '../vector_delete'
import fulltextUpsert from '../fulltext_upsert'

/**
 * The unscoped-record lookup reads `organization_id`/`tenant_id` from the
 * entity table and swallows failures (global tables such as `feature_toggles`
 * lack those columns). Running it on the shared request EntityManager let the
 * failed statement land inside whatever write transaction that EM currently
 * held (e.g. the audit redo finalization flush), aborting it. The lookup must
 * run on a fork so a swallowed error can never poison a caller's transaction.
 */
function buildContext() {
  const executeTakeFirst = jest.fn().mockRejectedValue(new Error('column "organization_id" does not exist'))
  const where = jest.fn(() => ({ executeTakeFirst }))
  const select = jest.fn(() => ({ where }))
  const forkKysely = { selectFrom: jest.fn(() => ({ select })) }
  const forkEm = { getKysely: jest.fn(() => forkKysely) }
  const requestEm = { getKysely: jest.fn(), fork: jest.fn(() => forkEm) }
  const ctx = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return requestEm
      throw new Error(`[internal] not registered: ${name}`)
    }),
  }
  return { ctx, requestEm, forkEm, executeTakeFirst }
}

type SubscriberHandler = (payload: Record<string, unknown>, ctx: unknown) => Promise<void>

describe('search subscriber scope lookup isolation', () => {
  it.each<[string, SubscriberHandler, Record<string, unknown>]>([
    ['query_index.vectorize_one', vectorUpsert as SubscriberHandler, { entityType: 'feature_toggles:feature_toggle', recordId: 'r1', tenantId: null, organizationId: null }],
    ['query_index.delete_one', vectorDelete as SubscriberHandler, { entityType: 'feature_toggles:feature_toggle', recordId: 'r1', tenantId: null, organizationId: null }],
    ['search.index_record', fulltextUpsert as SubscriberHandler, { entityId: 'feature_toggles:feature_toggle', recordId: 'r1', tenantId: null, organizationId: null }],
  ])('%s never runs the unscoped lookup on the request EntityManager', async (_event, handler, payload) => {
    const { ctx, requestEm, forkEm, executeTakeFirst } = buildContext()

    await expect(handler(payload, ctx)).resolves.toBeUndefined()

    expect(requestEm.getKysely).not.toHaveBeenCalled()
    expect(requestEm.fork).toHaveBeenCalledTimes(1)
    expect(forkEm.getKysely).toHaveBeenCalledTimes(1)
    expect(executeTakeFirst).toHaveBeenCalledTimes(1)
  })
})
