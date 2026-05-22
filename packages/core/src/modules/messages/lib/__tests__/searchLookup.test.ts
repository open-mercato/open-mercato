import { findMessageIdsBySearchTokens } from '../searchLookup'
import { tokenizeText } from '@open-mercato/shared/lib/search/tokenize'
import { resolveSearchConfig } from '@open-mercato/shared/lib/search/config'

type KyselyCall = {
  method: string
  args: unknown[]
}

function createKyselyMock(rows: Array<{ entity_id: string }>) {
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
  return { db, calls, tableNameRef, builder }
}

function createEm(db: unknown) {
  return {
    getKysely: () => db,
  }
}

function compileSql(raw: any): string {
  if (typeof raw?.toOperationNode === 'function') {
    const node = raw.toOperationNode()
    return Array.isArray(node?.sqlFragments) ? node.sqlFragments.join(' ? ') : ''
  }
  return String(raw?.sql ?? raw)
}

describe('findMessageIdsBySearchTokens', () => {
  it('returns null when query is empty', async () => {
    const { db } = createKyselyMock([])
    const em = createEm(db)
    const result = await findMessageIdsBySearchTokens({
      em: em as never,
      query: '   ',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(result).toBeNull()
  })

  it('returns empty array when query produces no searchable tokens', async () => {
    const { db } = createKyselyMock([])
    const em = createEm(db)
    const result = await findMessageIdsBySearchTokens({
      em: em as never,
      query: '!',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(result).toEqual([])
  })

  it('queries search_tokens with hashed tokens and the messages:message scope', async () => {
    const rows = [{ entity_id: 'msg-1' }, { entity_id: 'msg-2' }]
    const { db, calls, tableNameRef } = createKyselyMock(rows)
    const em = createEm(db)
    const result = await findMessageIdsBySearchTokens({
      em: em as never,
      query: 'Hello',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(result).toEqual(['msg-1', 'msg-2'])
    expect(tableNameRef.value).toBe('search_tokens')

    const whereCalls = calls.filter((call) => call.method === 'where')
    expect(whereCalls).toContainEqual({ method: 'where', args: ['entity_type', '=', 'messages:message'] })
    expect(whereCalls).toContainEqual({ method: 'where', args: ['organization_id', '=', 'org-1'] })

    const fieldFilter = whereCalls.find((call) => call.args[0] === 'field' && call.args[1] === 'in')
    expect(fieldFilter?.args[2]).toEqual(['subject', 'body', 'external_name'])

    const hashFilter = whereCalls.find((call) => call.args[0] === 'token_hash' && call.args[1] === 'in')
    const expected = tokenizeText('Hello', resolveSearchConfig()).hashes
    expect(hashFilter?.args[2]).toEqual(expected)

    const havingCall = calls.find((call) => call.method === 'having')
    expect(havingCall).toBeDefined()
    expect(compileSql(havingCall?.args[0])).toContain('count(distinct token_hash) >=')
  })

  it('uses a null-safe tenant filter and scopes organization_id for shared-org requests', async () => {
    const { db, calls } = createKyselyMock([])
    const em = createEm(db)
    await findMessageIdsBySearchTokens({
      em: em as never,
      query: 'Hello',
      tenantId: null,
      organizationId: null,
    })
    const rawWhereCalls = calls.filter(
      (call) => call.method === 'where' && call.args.length === 1,
    )
    const compiled = rawWhereCalls.map((call) => compileSql(call.args[0]))
    expect(compiled.some((s) => s.includes('tenant_id is not distinct from'))).toBe(true)
    expect(compiled.some((s) => s.includes('organization_id is not distinct from'))).toBe(true)
  })
})
