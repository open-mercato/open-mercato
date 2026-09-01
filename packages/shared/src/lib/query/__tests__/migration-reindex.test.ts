import {
  QUERY_INDEX_REINDEX_EXPORT,
  declareQueryIndexReindex,
  formatQueryIndexRebuildCommands,
  readQueryIndexReindexDeclaration,
} from '../migration-reindex'

describe('declareQueryIndexReindex', () => {
  it('normalizes and freezes the declared entity types', () => {
    const declared = declareQueryIndexReindex([
      'customers:customer_dictionary_entry',
      'customers:customer_dictionary_entry',
      'workflows:workflow_definition',
    ])

    expect(declared).toEqual(['customers:customer_dictionary_entry', 'workflows:workflow_definition'])
    expect(Object.isFrozen(declared)).toBe(true)
  })

  it('rejects identifiers that are not module:entity', () => {
    expect(() => declareQueryIndexReindex(['customer_dictionary_entries'])).toThrow(/module:entity/)
    expect(() => declareQueryIndexReindex(['customers:Customer-Dictionary-Entry'])).toThrow(/module:entity/)
    expect(() => declareQueryIndexReindex([])).toThrow(/at least one entity type/)
  })
})

describe('readQueryIndexReindexDeclaration', () => {
  it('reads the declaration from a migration module', () => {
    const moduleExports = {
      [QUERY_INDEX_REINDEX_EXPORT]: ['dictionaries:dictionary_entry', 'dictionaries:dictionary_entry'],
    }

    expect(readQueryIndexReindexDeclaration(moduleExports)).toEqual(['dictionaries:dictionary_entry'])
  })

  it('returns nothing for migrations that declare nothing', () => {
    expect(readQueryIndexReindexDeclaration({})).toEqual([])
    expect(readQueryIndexReindexDeclaration(null)).toEqual([])
    expect(readQueryIndexReindexDeclaration({ [QUERY_INDEX_REINDEX_EXPORT]: 'customers:deal' })).toEqual([])
  })

  it('drops malformed entries instead of propagating them into a reindex request', () => {
    const moduleExports = {
      [QUERY_INDEX_REINDEX_EXPORT]: ['customers:deal', 42, 'not-an-entity-type', null],
    }

    expect(readQueryIndexReindexDeclaration(moduleExports)).toEqual(['customers:deal'])
  })
})

describe('formatQueryIndexRebuildCommands', () => {
  it('renders the operator fallback command for every entity type', () => {
    expect(formatQueryIndexRebuildCommands(['customers:deal'])).toEqual([
      'mercato query_index rebuild --entity customers:deal --global',
    ])
  })
})
