import {
  findEntityIdsBySearchTokens,
  findEntityIdsBySearchTokensCompat,
} from '../tokenLookup'
import { resolveSearchConfig } from '../config'
import { tokenizeText } from '../tokenize'

type KyselyCall = {
  method: string
  args: unknown[]
}

function createKyselyMock(rows: Array<{ entity_id: unknown }>) {
  const calls: KyselyCall[] = []
  const tableNameRef: { value: string | null } = { value: null }
  const builder: Record<string, unknown> = {}
  const passthrough = (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args })
      return builder
    }
  builder.select = passthrough('select')
  builder.where = passthrough('where')
  builder.groupBy = passthrough('groupBy')
  builder.having = passthrough('having')
  builder.execute = jest.fn(async () => rows)

  const db = {
    selectFrom: (table: string) => {
      tableNameRef.value = table
      return builder
    },
  }
  return { db: db as never, calls, tableNameRef, builder }
}

function compileSql(raw: unknown): string {
  if (raw && typeof raw === 'object' && 'toOperationNode' in raw && typeof raw.toOperationNode === 'function') {
    const node = raw.toOperationNode() as { sqlFragments?: unknown }
    return Array.isArray(node.sqlFragments) ? node.sqlFragments.join(' ? ') : ''
  }
  if (raw && typeof raw === 'object' && 'sql' in raw) return String(raw.sql)
  return String(raw)
}

function rawWhereFragments(calls: KyselyCall[]): string[] {
  return calls
    .filter((call) => call.method === 'where' && call.args.length === 1)
    .map((call) => compileSql(call.args[0]))
}

describe('findEntityIdsBySearchTokens', () => {
  const baseInput = {
    entityType: 'customers:customer_entity',
    query: 'Hello',
  }

  it('skips the lookup for a blank query', async () => {
    const { db, builder } = createKyselyMock([])
    const result = await findEntityIdsBySearchTokens({ ...baseInput, db, query: '   ' })
    expect(result).toEqual({ matched: false, reason: 'empty-query' })
    expect(builder.execute).not.toHaveBeenCalled()
  })

  it('skips the lookup when token search is disabled', async () => {
    const { db, builder } = createKyselyMock([])
    const result = await findEntityIdsBySearchTokens({
      ...baseInput,
      db,
      config: { ...resolveSearchConfig(), enabled: false },
    })
    expect(result).toEqual({ matched: false, reason: 'search-disabled' })
    expect(builder.execute).not.toHaveBeenCalled()
  })

  it('skips the lookup when the query yields no indexable tokens', async () => {
    const { db, builder } = createKyselyMock([])
    const result = await findEntityIdsBySearchTokens({ ...baseInput, db, query: '!' })
    expect(result).toEqual({ matched: false, reason: 'no-tokens' })
    expect(builder.execute).not.toHaveBeenCalled()
  })

  it('requires every query token to be present on the record', async () => {
    const { db, calls } = createKyselyMock([{ entity_id: 'a' }])
    await findEntityIdsBySearchTokens({ ...baseInput, db, query: 'ada lovelace' })

    const expectedHashes = tokenizeText('ada lovelace', resolveSearchConfig()).hashes
    const hashFilter = calls.find((call) => call.args[0] === 'token_hash' && call.args[1] === 'in')
    expect(hashFilter?.args[2]).toEqual(expectedHashes)

    const having = calls.find((call) => call.method === 'having')
    expect(compileSql(having?.args[0])).toContain('count(distinct token_hash) >=')
  })

  it('returns the matched ids and drops non-string rows', async () => {
    const { db, tableNameRef } = createKyselyMock([
      { entity_id: 'id-1' },
      { entity_id: null },
      { entity_id: 42 },
      { entity_id: '' },
      { entity_id: 'id-2' },
    ])
    const result = await findEntityIdsBySearchTokens({ ...baseInput, db })
    expect(result).toEqual({ matched: true, ids: ['id-1', 'id-2'] })
    expect(tableNameRef.value).toBe('search_tokens')
  })

  it('reports an empty match instead of a skip when nothing matched', async () => {
    const { db } = createKyselyMock([])
    const result = await findEntityIdsBySearchTokens({ ...baseInput, db })
    expect(result).toEqual({ matched: true, ids: [] })
  })

  it('narrows a single field with equality and multiple fields with IN', async () => {
    const single = createKyselyMock([])
    await findEntityIdsBySearchTokens({ ...baseInput, db: single.db, fields: ['name'] })
    expect(single.calls).toContainEqual({ method: 'where', args: ['field', '=', 'name'] })

    const multi = createKyselyMock([])
    await findEntityIdsBySearchTokens({ ...baseInput, db: multi.db, fields: ['name', 'email'] })
    expect(multi.calls).toContainEqual({ method: 'where', args: ['field', 'in', ['name', 'email']] })
  })

  it('omits the field predicate when no fields are supplied', async () => {
    const { db, calls } = createKyselyMock([])
    await findEntityIdsBySearchTokens({ ...baseInput, db, fields: [] })
    expect(calls.some((call) => call.args[0] === 'field')).toBe(false)
  })

  it('omits tenant and organization predicates when the scope is absent', async () => {
    const { db, calls } = createKyselyMock([])
    await findEntityIdsBySearchTokens({ ...baseInput, db })
    expect(rawWhereFragments(calls)).toEqual([])
    expect(calls.some((call) => call.args[0] === 'organization_id')).toBe(false)
  })

  it('emits a null-safe tenant predicate for an explicit null tenant', async () => {
    const { db, calls } = createKyselyMock([])
    await findEntityIdsBySearchTokens({ ...baseInput, db, scope: { tenantId: null } })
    expect(rawWhereFragments(calls).some((s) => s.includes('tenant_id is not distinct from'))).toBe(true)
  })

  it('emits a null-safe organization predicate for an explicit null organization', async () => {
    const { db, calls } = createKyselyMock([])
    await findEntityIdsBySearchTokens({ ...baseInput, db, scope: { organizationId: null } })
    expect(rawWhereFragments(calls).some((s) => s.includes('organization_id is not distinct from'))).toBe(true)
  })

  it('prefers a concrete organization over the visible-organization list', async () => {
    const { db, calls } = createKyselyMock([])
    await findEntityIdsBySearchTokens({
      ...baseInput,
      db,
      scope: { organizationId: 'org-1', organizationIds: ['org-1', 'org-2'] },
    })
    expect(calls).toContainEqual({ method: 'where', args: ['organization_id', '=', 'org-1'] })
    expect(calls.some((call) => call.args[1] === 'in' && call.args[0] === 'organization_id')).toBe(false)
  })

  it('falls back to the visible-organization list when no organization is selected', async () => {
    const { db, calls } = createKyselyMock([])
    await findEntityIdsBySearchTokens({
      ...baseInput,
      db,
      scope: { organizationIds: ['org-1', 'org-2'] },
    })
    expect(calls).toContainEqual({ method: 'where', args: ['organization_id', 'in', ['org-1', 'org-2']] })
  })
})

describe('findEntityIdsBySearchTokensCompat', () => {
  it('returns null only for a blank query', async () => {
    const { db } = createKyselyMock([])
    await expect(findEntityIdsBySearchTokensCompat({
      db,
      entityType: 'customers:customer_entity',
      query: ' ',
    })).resolves.toBeNull()
  })

  it('returns an empty array for the remaining skip reasons', async () => {
    const noTokens = createKyselyMock([])
    await expect(findEntityIdsBySearchTokensCompat({
      db: noTokens.db,
      entityType: 'customers:customer_entity',
      query: '!',
    })).resolves.toEqual([])

    const disabled = createKyselyMock([])
    await expect(findEntityIdsBySearchTokensCompat({
      db: disabled.db,
      entityType: 'customers:customer_entity',
      query: 'Hello',
      config: { ...resolveSearchConfig(), enabled: false },
    })).resolves.toEqual([])
  })

  it('returns the matched ids', async () => {
    const { db } = createKyselyMock([{ entity_id: 'id-1' }])
    await expect(findEntityIdsBySearchTokensCompat({
      db,
      entityType: 'customers:customer_entity',
      query: 'Hello',
    })).resolves.toEqual(['id-1'])
  })
})
