import { findMessageIdsBySearchTokens } from '../searchLookup'
import { tokenizeText } from '@open-mercato/shared/lib/search/tokenize'
import { resolveSearchConfig } from '@open-mercato/shared/lib/search/config'

type KnexCall = {
  method: string
  args: unknown[]
}

function createKnexMock(rows: Array<{ entity_id: string }>) {
  const calls: KnexCall[] = []
  const builder: Record<string, unknown> = {}
  const tableNameRef: { value: string | null } = { value: null }
  const passthrough = (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args })
      return builder
    }
  builder.select = passthrough('select')
  builder.where = passthrough('where')
  builder.whereIn = passthrough('whereIn')
  builder.whereRaw = passthrough('whereRaw')
  builder.groupBy = passthrough('groupBy')
  builder.havingRaw = passthrough('havingRaw')
  builder.then = (resolve: (value: Array<{ entity_id: string }>) => unknown) =>
    Promise.resolve(rows).then(resolve)
  const knex = (table: string) => {
    tableNameRef.value = table
    return builder
  }
  return { knex, calls, tableNameRef }
}

function createEm(knex: (table: string) => unknown) {
  return {
    getConnection: () => ({
      getKnex: () => knex,
    }),
  }
}

describe('findMessageIdsBySearchTokens', () => {
  it('returns null when query is empty', async () => {
    const { knex } = createKnexMock([])
    const em = createEm(knex as never)
    const result = await findMessageIdsBySearchTokens({
      em: em as never,
      query: '   ',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(result).toBeNull()
  })

  it('returns empty array when query produces no searchable tokens', async () => {
    const { knex } = createKnexMock([])
    const em = createEm(knex as never)
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
    const { knex, calls, tableNameRef } = createKnexMock(rows)
    const em = createEm(knex as never)
    const result = await findMessageIdsBySearchTokens({
      em: em as never,
      query: 'Hello',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(result).toEqual(['msg-1', 'msg-2'])
    expect(tableNameRef.value).toBe('search_tokens')

    const whereCalls = calls.filter((call) => call.method === 'where')
    expect(whereCalls).toContainEqual({ method: 'where', args: ['entity_type', 'messages:message'] })
    expect(whereCalls).toContainEqual({ method: 'where', args: ['organization_id', 'org-1'] })

    const whereInCalls = calls.filter((call) => call.method === 'whereIn')
    const fieldFilter = whereInCalls.find((call) => call.args[0] === 'field')
    expect(fieldFilter?.args[1]).toEqual(['subject', 'body', 'external_name'])

    const hashFilter = whereInCalls.find((call) => call.args[0] === 'token_hash')
    const expected = tokenizeText('Hello', resolveSearchConfig()).hashes
    expect(hashFilter?.args[1]).toEqual(expected)

    const havingCall = calls.find((call) => call.method === 'havingRaw')
    expect(havingCall?.args[0]).toBe('count(distinct token_hash) >= ?')
    expect(havingCall?.args[1]).toEqual([expected.length])
  })

  it('uses a null-safe tenant filter and scopes organization_id for shared-org requests', async () => {
    const { knex, calls } = createKnexMock([])
    const em = createEm(knex as never)
    await findMessageIdsBySearchTokens({
      em: em as never,
      query: 'Hello',
      tenantId: null,
      organizationId: null,
    })
    const rawCalls = calls.filter((call) => call.method === 'whereRaw')
    expect(rawCalls).toContainEqual({
      method: 'whereRaw',
      args: ['tenant_id is not distinct from ?', [null]],
    })
    expect(rawCalls).toContainEqual({
      method: 'whereRaw',
      args: ['organization_id is not distinct from ?', [null]],
    })
  })
})
