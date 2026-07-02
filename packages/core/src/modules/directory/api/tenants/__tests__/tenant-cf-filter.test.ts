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

  it('scopes definition and value queries to the tenant or global rows', async () => {
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
    for (const call of calls) {
      expect(call.where.tenantId).toEqual({ $in: [tenantId, null] })
    }
  })
})
