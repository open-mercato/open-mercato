import {
  CUSTOMERS_BASE_ENTITY_TYPE,
  indexesCustomerBaseEntity,
  listSearchTokenExcludedEntityTypes,
  passesSearchTokenIndexGates,
  resolveSearchTokenIndexGates,
} from '../lib/search-entity-policy'
import { registerSearchModuleConfigs } from '@open-mercato/shared/modules/search'
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
    expect(listSearchTokenExcludedEntityTypes()).toEqual([CUSTOMERS_BASE_ENTITY_TYPE])
  })

  it('returns base customer entities when the flag is on', () => {
    process.env.OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY = 'true'
    expect(indexesCustomerBaseEntity()).toBe(true)
    expect(listSearchTokenExcludedEntityTypes()).toEqual([])
  })

  it('never excludes any other entity type, whatever the flag says', () => {
    delete process.env.OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY
    expect(listSearchTokenExcludedEntityTypes()).not.toContain(PERSON_PROFILE)
    process.env.OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY = 'false'
    expect(listSearchTokenExcludedEntityTypes()).not.toContain(PERSON_PROFILE)
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

describe('search token index gates', () => {
  afterEach(() => registerSearchModuleConfigs([]))

  const input = { recordId: 'rec-1', record: { id: 'rec-1' }, tenantId: 't1', organizationId: null }

  it('resolves no gate for entities without shouldIndex', () => {
    registerSearchModuleConfigs([{ entities: [{ entityId: 'example:todo' }] }])
    expect(resolveSearchTokenIndexGates('example:todo')).toEqual([])
  })

  it('resolves the gate even when the entity config is disabled', () => {
    const gate = () => true
    registerSearchModuleConfigs([{ entities: [{ entityId: 'example:todo', enabled: false, shouldIndex: gate }] }])
    expect(resolveSearchTokenIndexGates('example:todo')).toEqual([gate])
    expect(resolveSearchTokenIndexGates('example:other')).toEqual([])
  })

  it('accepts only a strict true from every gate', async () => {
    await expect(passesSearchTokenIndexGates('example:todo', [() => true, async () => true], input)).resolves.toBe(true)
    await expect(passesSearchTokenIndexGates('example:todo', [() => true, () => false], input)).resolves.toBe(false)
    await expect(passesSearchTokenIndexGates('example:todo', [() => 'yes' as unknown as boolean], input)).resolves.toBe(false)
  })

  it('fails closed when a gate throws', async () => {
    const throwing = () => {
      throw new Error('lookup failed')
    }
    await expect(passesSearchTokenIndexGates('example:todo', [throwing], input)).resolves.toBe(false)
  })
})
