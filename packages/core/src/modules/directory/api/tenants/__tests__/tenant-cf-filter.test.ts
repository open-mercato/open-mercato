/** @jest-environment node */

import { resolveRecordIdsForCustomFieldFilters } from '../tenant-cf-filter'

const tenantId = '11111111-1111-4111-8111-111111111111'
const entityId = 'directory:tenant'

type FindCall = { entity: { name: string }; where: Record<string, unknown> }

const makeEm = (handlers: {
  defs: { key: string; kind: string }[]
  valuesByCall: Record<string, { recordId: string }[]>
}) => {
  const calls: FindCall[] = []
  const find = jest.fn(async (entity: { name: string }, where: Record<string, unknown>) => {
    calls.push({ entity, where })
    if (entity.name === 'CustomFieldDef') return handlers.defs
    if (entity.name === 'CustomFieldValue') {
      const key = String((where as { fieldKey?: string }).fieldKey)
      return handlers.valuesByCall[key] ?? []
    }
    throw new Error(`Unexpected entity ${entity.name}`)
  })
  return { em: { find } as never, calls, find }
}

describe('resolveRecordIdsForCustomFieldFilters', () => {
  it('returns an empty set when there are no filters', async () => {
    const { em, find } = makeEm({ defs: [], valuesByCall: {} })
    const ids = await resolveRecordIdsForCustomFieldFilters({ em, entityId, tenantId, filters: [] })
    expect(ids.size).toBe(0)
    expect(find).not.toHaveBeenCalled()
  })

  it('selects the value column from the field definition kind', async () => {
    const { em, calls } = makeEm({
      defs: [{ key: 'score', kind: 'integer' }],
      valuesByCall: { score: [{ recordId: 'a' }] },
    })
    const ids = await resolveRecordIdsForCustomFieldFilters({
      em,
      entityId,
      tenantId,
      filters: [['score', { $in: [10] }]],
    })
    expect(Array.from(ids)).toEqual(['a'])
    const valueCall = calls.find((call) => call.entity.name === 'CustomFieldValue')!
    expect(valueCall.where).toMatchObject({ fieldKey: 'score', valueInt: { $in: [10] } })
    expect(valueCall.where).not.toHaveProperty('valueText')
  })

  it('falls back to the text column for unknown/text kinds', async () => {
    const { em, calls } = makeEm({
      defs: [{ key: 'tier', kind: 'text' }],
      valuesByCall: { tier: [{ recordId: 'a' }] },
    })
    await resolveRecordIdsForCustomFieldFilters({
      em,
      entityId,
      tenantId,
      filters: [['tier', 'gold']],
    })
    const valueCall = calls.find((call) => call.entity.name === 'CustomFieldValue')!
    expect(valueCall.where).toMatchObject({ fieldKey: 'tier', valueText: { $in: ['gold'] } })
  })

  it('intersects record ids across multiple filters (AND semantics)', async () => {
    const { em } = makeEm({
      defs: [
        { key: 'tier', kind: 'text' },
        { key: 'region', kind: 'text' },
      ],
      valuesByCall: {
        tier: [{ recordId: 'a' }, { recordId: 'b' }],
        region: [{ recordId: 'b' }, { recordId: 'c' }],
      },
    })
    const ids = await resolveRecordIdsForCustomFieldFilters({
      em,
      entityId,
      tenantId,
      filters: [
        ['tier', 'gold'],
        ['region', 'eu'],
      ],
    })
    expect(Array.from(ids)).toEqual(['b'])
  })

  it('short-circuits to an empty set when an earlier filter matches nothing', async () => {
    const { em, find } = makeEm({
      defs: [
        { key: 'tier', kind: 'text' },
        { key: 'region', kind: 'text' },
      ],
      valuesByCall: { tier: [], region: [{ recordId: 'b' }] },
    })
    const ids = await resolveRecordIdsForCustomFieldFilters({
      em,
      entityId,
      tenantId,
      filters: [
        ['tier', 'gold'],
        ['region', 'eu'],
      ],
    })
    expect(ids.size).toBe(0)
    const valueCalls = find.mock.calls.filter(([entity]) => entity.name === 'CustomFieldValue')
    expect(valueCalls).toHaveLength(1)
  })

  describe('tenant scope with SQL NULL semantics', () => {
    const otherTenantId = '22222222-2222-4222-8222-222222222222'

    type Row = Record<string, unknown>

    const matchesCondition = (columnValue: unknown, condition: unknown): boolean => {
      if (condition && typeof condition === 'object' && !Array.isArray(condition) && '$in' in (condition as Row)) {
        const candidates = (condition as { $in: unknown[] }).$in
        if (columnValue === null) return false
        return candidates.some((candidate) => candidate !== null && candidate === columnValue)
      }
      return columnValue === (condition ?? null)
    }

    const matchesWhere = (row: Row, where: Row): boolean =>
      Object.entries(where).every(([key, condition]) => {
        if (key === '$and') return (condition as Row[]).every((sub) => matchesWhere(row, sub))
        if (key === '$or') return (condition as Row[]).some((sub) => matchesWhere(row, sub))
        return matchesCondition(row[key] ?? null, condition)
      })

    const makeSqlLikeEm = (tables: { defs: Row[]; values: Row[] }) => {
      const find = jest.fn(async (entity: { name: string }, where: Row) => {
        const table = entity.name === 'CustomFieldDef' ? tables.defs : tables.values
        return table.filter((row) => matchesWhere(row, where))
      })
      return { find } as never
    }

    const defRow = (overrides: Row): Row => ({
      entityId,
      key: 'score',
      kind: 'integer',
      tenantId,
      isActive: true,
      deletedAt: null,
      ...overrides,
    })

    const valueRow = (overrides: Row): Row => ({
      entityId,
      fieldKey: 'score',
      recordId: 'a',
      tenantId,
      valueText: null,
      valueInt: null,
      deletedAt: null,
      ...overrides,
    })

    it('reads the value column from a definition with tenant_id NULL', async () => {
      const em = makeSqlLikeEm({
        defs: [defRow({ tenantId: null })],
        values: [valueRow({ valueInt: 10 })],
      })
      const ids = await resolveRecordIdsForCustomFieldFilters({
        em,
        entityId,
        tenantId,
        filters: [['score', 10]],
      })
      expect(Array.from(ids)).toEqual(['a'])
    })

    it('matches values stored with tenant_id NULL', async () => {
      const em = makeSqlLikeEm({
        defs: [defRow({})],
        values: [valueRow({ tenantId: null, valueInt: 10 })],
      })
      const ids = await resolveRecordIdsForCustomFieldFilters({
        em,
        entityId,
        tenantId,
        filters: [['score', 10]],
      })
      expect(Array.from(ids)).toEqual(['a'])
    })

    it('never reads the value column from a definition of another tenant', async () => {
      const em = makeSqlLikeEm({
        defs: [defRow({ tenantId: otherTenantId })],
        values: [valueRow({ valueInt: 10 })],
      })
      const ids = await resolveRecordIdsForCustomFieldFilters({
        em,
        entityId,
        tenantId,
        filters: [['score', 10]],
      })
      expect(ids.size).toBe(0)
    })

    it('never matches values of another tenant', async () => {
      const em = makeSqlLikeEm({
        defs: [defRow({})],
        values: [valueRow({ tenantId: otherTenantId, valueInt: 10 })],
      })
      const ids = await resolveRecordIdsForCustomFieldFilters({
        em,
        entityId,
        tenantId,
        filters: [['score', 10]],
      })
      expect(ids.size).toBe(0)
    })
  })
})
