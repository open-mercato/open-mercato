import { TokenSearchStrategy } from '../strategies/token.strategy'

/**
 * Coverage for `OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY` on the read path (#5046).
 *
 * The writer already refuses to tokenize an excluded entity, but rows written before the flag was
 * set survive until that record is next indexed. Without a read-side filter a deployment that
 * flips the flag keeps serving the duplicate base-customer hits until a full reindex, so these
 * tests pin the SQL predicate rather than the writer's behavior.
 */

const CUSTOMER_ENTITY = 'customers:customer_entity'
const PERSON_PROFILE = 'customers:customer_person_profile'

type RecordedWhere = [string, string, unknown]

function createMockDb() {
  const wheres: RecordedWhere[] = []
  const builder: Record<string, unknown> = {
    select: jest.fn(() => builder),
    where: jest.fn((column: unknown, op?: unknown, value?: unknown) => {
      if (typeof column === 'string' && typeof op === 'string') wheres.push([column, op, value])
      return builder
    }),
    groupBy: jest.fn(() => builder),
    having: jest.fn(() => builder),
    orderBy: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    execute: jest.fn().mockResolvedValue([]),
  }
  const db = { selectFrom: jest.fn(() => builder) }
  return { db, wheres, builder }
}

const entityTypePredicates = (wheres: RecordedWhere[]) => wheres.filter(([column]) => column === 'entity_type')

const originalFlag = process.env.OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY

afterEach(() => {
  if (originalFlag === undefined) delete process.env.OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY
  else process.env.OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY = originalFlag
})

describe('TokenSearchStrategy excludes base customer entities by default', () => {
  it('adds a NOT IN predicate when the caller requests no specific entity types', async () => {
    delete process.env.OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY
    const { db, wheres } = createMockDb()
    const strategy = new TokenSearchStrategy(db as never)

    await strategy.search('ada lovelace', { tenantId: 'tenant-1' })

    expect(entityTypePredicates(wheres)).toEqual([['entity_type', 'not in', [CUSTOMER_ENTITY]]])
  })

  it('drops the excluded type from an explicit entityTypes filter and keeps the rest', async () => {
    delete process.env.OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY
    const { db, wheres } = createMockDb()
    const strategy = new TokenSearchStrategy(db as never)

    await strategy.search('ada lovelace', {
      tenantId: 'tenant-1',
      entityTypes: [CUSTOMER_ENTITY, PERSON_PROFILE],
    })

    expect(entityTypePredicates(wheres)).toEqual([['entity_type', 'in', [PERSON_PROFILE]]])
  })

  it('returns no results — and issues no query — when only excluded types were requested', async () => {
    delete process.env.OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY
    const { db } = createMockDb()
    const strategy = new TokenSearchStrategy(db as never)

    const results = await strategy.search('ada lovelace', {
      tenantId: 'tenant-1',
      entityTypes: [CUSTOMER_ENTITY],
    })

    expect(results).toEqual([])
    expect(db.selectFrom).not.toHaveBeenCalled()
  })

  it('leaves the query untouched when the flag re-enables base customer entities', async () => {
    process.env.OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY = 'true'
    const { db, wheres } = createMockDb()
    const strategy = new TokenSearchStrategy(db as never)

    await strategy.search('ada lovelace', { tenantId: 'tenant-1' })
    expect(entityTypePredicates(wheres)).toEqual([])

    await strategy.search('ada lovelace', {
      tenantId: 'tenant-1',
      entityTypes: [CUSTOMER_ENTITY, PERSON_PROFILE],
    })
    expect(entityTypePredicates(wheres)).toEqual([['entity_type', 'in', [CUSTOMER_ENTITY, PERSON_PROFILE]]])
  })
})
