import {
  CUSTOMERS_BASE_ENTITY_TYPE,
  indexesCustomerBaseEntity,
  isEntityTypeExcludedFromSearchTokens,
  listSearchTokenExcludedEntityTypes,
} from '../lib/search-entity-policy'
import { buildSearchTokenRows } from '../lib/search-tokens'

const PERSON_PROFILE = 'customers:customer_person_profile'

const originalFlag = process.env.OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY

afterEach(() => {
  if (originalFlag === undefined) delete process.env.OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY
  else process.env.OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY = originalFlag
})

describe('OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY', () => {
  it('keeps base customer entities out of token search results by default', () => {
    delete process.env.OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY
    expect(indexesCustomerBaseEntity()).toBe(false)
    expect(isEntityTypeExcludedFromSearchTokens(CUSTOMERS_BASE_ENTITY_TYPE)).toBe(true)
    expect(listSearchTokenExcludedEntityTypes()).toEqual([CUSTOMERS_BASE_ENTITY_TYPE])
  })

  it('returns base customer entities when the flag is on', () => {
    process.env.OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY = 'true'
    expect(indexesCustomerBaseEntity()).toBe(true)
    expect(isEntityTypeExcludedFromSearchTokens(CUSTOMERS_BASE_ENTITY_TYPE)).toBe(false)
    expect(listSearchTokenExcludedEntityTypes()).toEqual([])
  })

  it('never excludes any other entity type, whatever the flag says', () => {
    delete process.env.OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY
    expect(isEntityTypeExcludedFromSearchTokens(PERSON_PROFILE)).toBe(false)
    process.env.OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY = 'false'
    expect(isEntityTypeExcludedFromSearchTokens(PERSON_PROFILE)).toBe(false)
  })
})

/**
 * The exclusion is read-side only. `search_tokens` doubles as the encrypted-column lookup index:
 * `customers/api/people/route.ts` and `.../companies/route.ts` resolve their search box through
 * `findEntityIdsBySearchTokens` on `customers:customer_entity`, and both query engines rewrite
 * `like`/`ilike` on encrypted customer columns into the same table. If the writer ever started
 * honouring the flag, list search on `display_name` / `primary_email` / `description` would return
 * nothing — so the rows must keep being written whatever the flag says.
 */
describe('the base-entity exclusion never touches the token writer', () => {
  const doc = { display_name: 'Ada Lovelace', description: 'Analytical engine pioneer' }
  const buildRows = (entityType: string) => buildSearchTokenRows({ entityType, recordId: 'rec-1', doc })

  it('keeps writing base customer entity tokens while the flag is off', () => {
    delete process.env.OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY
    const fields = new Set(buildRows(CUSTOMERS_BASE_ENTITY_TYPE).map((row) => row.field))
    expect(fields.has('display_name')).toBe(true)
    expect(fields.has('description')).toBe(true)
  })

  it('writes exactly the same rows when the flag is on', () => {
    delete process.env.OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY
    const withFlagOff = buildRows(CUSTOMERS_BASE_ENTITY_TYPE)
    process.env.OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY = 'true'
    expect(buildRows(CUSTOMERS_BASE_ENTITY_TYPE)).toEqual(withFlagOff)
  })

  it('keeps writing rows for the profile entities the customer is found by', () => {
    delete process.env.OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY
    expect(buildRows(PERSON_PROFILE).length).toBeGreaterThan(0)
  })
})
