import type { EntityManager } from '@mikro-orm/postgresql'
import type { Kysely } from 'kysely'
import { BasicQueryEngine } from '../engine'
import type { Filter } from '../types'

describe('BasicQueryEngine invalid filters (#7831)', () => {
  test.each([
    { $or: [] },
    { $and: [{ status: 'open' }, { $or: [] }] },
    { status: { $unsupported: 'open' } },
    [{ field: 'status', op: 'unsupported', value: 'open' }] as unknown as Filter[],
  ])('rejects %j before querying rows', async (filters) => {
    const selectFrom = jest.fn()
    const database = { selectFrom } as unknown as Kysely<Record<string, never>>
    const engine = new BasicQueryEngine({} as EntityManager, () => database)

    await expect(engine.query('example:invalid_filter', { tenantId: 'tenant', filters })).rejects.toBeInstanceOf(TypeError)
    expect(selectFrom).not.toHaveBeenCalled()
  })
})
