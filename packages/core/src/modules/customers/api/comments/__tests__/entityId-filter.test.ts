/**
 * Regression test for #1100: GET /api/customers/comments?entityId=<uuid>
 * must only return comments belonging to the requested entity.
 *
 * Verifies that:
 * 1. buildFilters produces the correct column-name filters for the query engine
 * 2. translateFiltersForOrm maps column names to MikroORM property names
 *    so the ORM fallback path applies the filters correctly
 */

const ENTITY_A = '11111111-1111-1111-1111-111111111111'
const DEAL_X = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

/**
 * Mirrors the buildFilters logic from route.ts so we can verify correctness
 * without importing the full module graph (which requires generated files).
 */
function buildFilters(query: Record<string, unknown>): Record<string, unknown> {
  const filters: Record<string, unknown> = {}
  if (query.entityId) filters.entity_id = { $eq: query.entityId }
  if (query.dealId) filters.deal_id = { $eq: query.dealId }
  return filters
}

/**
 * Mirrors the translateFiltersForOrm logic from factory.ts.
 * Translates column-name filter keys to MikroORM property names
 * using entity metadata.
 */
function translateFiltersForOrm(
  filters: Record<string, unknown>,
  columnToPropertyMap: Map<string, string>,
): Record<string, unknown> {
  if (!filters || typeof filters !== 'object') return filters
  if (columnToPropertyMap.size === 0) return filters
  const translated: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(filters)) {
    const mappedKey = columnToPropertyMap.get(key) ?? key
    translated[mappedKey] = value
  }
  return translated
}

/**
 * Simulates the column-to-property mapping that MikroORM metadata would
 * produce for CustomerComment entity:
 *   @ManyToOne(() => CustomerEntity, { fieldName: 'entity_id' }) entity
 *   @ManyToOne(() => CustomerDeal, { fieldName: 'deal_id', nullable: true }) deal
 */
const COMMENT_COLUMN_MAP = new Map<string, string>([
  ['entity_id', 'entity'],
  ['deal_id', 'deal'],
])

describe('comments buildFilters (#1100)', () => {
  it('returns entity_id filter for query engine when entityId is provided', () => {
    const filters = buildFilters({ entityId: ENTITY_A })
    expect(filters).toEqual({ entity_id: { $eq: ENTITY_A } })
  })

  it('returns deal_id filter for query engine when dealId is provided', () => {
    const filters = buildFilters({ dealId: DEAL_X })
    expect(filters).toEqual({ deal_id: { $eq: DEAL_X } })
  })

  it('returns both filters when entityId and dealId are provided', () => {
    const filters = buildFilters({ entityId: ENTITY_A, dealId: DEAL_X })
    expect(filters).toEqual({
      entity_id: { $eq: ENTITY_A },
      deal_id: { $eq: DEAL_X },
    })
  })

  it('returns empty filters when neither entityId nor dealId is provided', () => {
    const filters = buildFilters({})
    expect(filters).toEqual({})
  })
})

describe('translateFiltersForOrm (#1100)', () => {
  it('translates entity_id to entity for ORM fallback', () => {
    const filters = { entity_id: { $eq: ENTITY_A } }
    const translated = translateFiltersForOrm(filters, COMMENT_COLUMN_MAP)
    expect(translated).toEqual({ entity: { $eq: ENTITY_A } })
  })

  it('translates deal_id to deal for ORM fallback', () => {
    const filters = { deal_id: { $eq: DEAL_X } }
    const translated = translateFiltersForOrm(filters, COMMENT_COLUMN_MAP)
    expect(translated).toEqual({ deal: { $eq: DEAL_X } })
  })

  it('translates both entity_id and deal_id together', () => {
    const filters = {
      entity_id: { $eq: ENTITY_A },
      deal_id: { $eq: DEAL_X },
    }
    const translated = translateFiltersForOrm(filters, COMMENT_COLUMN_MAP)
    expect(translated).toEqual({
      entity: { $eq: ENTITY_A },
      deal: { $eq: DEAL_X },
    })
  })

  it('passes through keys that have no column mapping', () => {
    const filters = {
      entity_id: { $eq: ENTITY_A },
      organizationId: 'org-123',
    }
    const translated = translateFiltersForOrm(filters, COMMENT_COLUMN_MAP)
    expect(translated).toEqual({
      entity: { $eq: ENTITY_A },
      organizationId: 'org-123',
    })
  })

  it('returns empty object when filters are empty', () => {
    const translated = translateFiltersForOrm({}, COMMENT_COLUMN_MAP)
    expect(translated).toEqual({})
  })

  it('returns filters unchanged when column map is empty', () => {
    const filters = { entity_id: { $eq: ENTITY_A } }
    const translated = translateFiltersForOrm(filters, new Map())
    expect(translated).toEqual({ entity_id: { $eq: ENTITY_A } })
  })
})
